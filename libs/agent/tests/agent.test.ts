import {
    AssistantMessage,
    Config,
    Message,
    Provider,
    Response,
    ToolCallMessage,
    ToolSpec,
} from '@spai/core'

import { Agent, AgentEvent } from '../src/agent'

type TestTool = {
    getSpec(): ToolSpec
    execute(params: unknown): Promise<string>
}

type ProviderCall = {
    messages: Message[]
    config: Config
    tools: ToolSpec[] | undefined
}

function createResponse(
    assistantMessage: AssistantMessage,
    toolCallMessages: ToolCallMessage[] = [],
    finishReason: Response['finishReason'] = 'stop'
): Response {
    return {
        assistantMessage,
        toolCallMessages,
        finishReason,
    }
}

function cloneMessage(message: Message): Message {
    return { ...message }
}

function cloneToolSpec(toolSpec: ToolSpec): ToolSpec {
    return {
        ...toolSpec,
        schema: structuredClone(toolSpec.schema),
    }
}

function createProvider(responses: Response[]) {
    const calls: ProviderCall[] = []
    const queue = [...responses]

    const generate: Provider['generate'] = async (messages, config, tools) => {
        calls.push({
            messages: messages.map(cloneMessage),
            config: { ...config },
            tools: tools?.map(cloneToolSpec),
        })

        const response = queue.shift()
        if (response === undefined) {
            throw new Error('unexpected generate call')
        }

        return response
    }

    return {
        calls,
        provider: { generate },
    }
}

function createTool(
    name: string,
    executeImpl: (params: unknown) => Promise<string> | string
): {
    tool: TestTool
    execute: jest.Mock<Promise<string>, [unknown]>
    spec: ToolSpec
} {
    const spec: ToolSpec = {
        name,
        description: `${name} description`,
        schema: {
            type: 'object',
        },
    }

    const execute = jest.fn<Promise<string>, [unknown]>(async (params) => {
        return await executeImpl(params)
    })

    return {
        tool: {
            getSpec: () => spec,
            execute,
        },
        execute,
        spec,
    }
}

describe('Agent', () => {
    const modelConfig: Config = { model: 'test-model' }
    const turnId = '00000000-0000-4000-8000-000000000000'

    beforeEach(() => {
        jest.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(turnId)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('runTurn completes in one iteration without tool calls', async () => {
        const { tool, spec } = createTool('lookup', async () => 'unused')
        const { calls, provider } = createProvider([
            createResponse({
                role: 'assistant',
                content: 'done',
            }),
        ])
        const events: AgentEvent[] = []
        const agent = new Agent(
            {
                provider,
                modelConfig,
            },
            [tool],
            (event) => events.push(event)
        )

        await agent.runTurn('hello')

        expect(calls).toEqual([
            {
                messages: [{ role: 'user', content: 'hello' }],
                config: modelConfig,
                tools: [spec],
            },
        ])
        expect(events).toEqual([
            { kind: 'turn-start', turnId, prompt: 'hello' },
            { kind: 'subturn-start', turnId, iteration: 1 },
            {
                kind: 'model-finish',
                turnId,
                iteration: 1,
                assistantMessage: { role: 'assistant', content: 'done' },
                toolCallMessages: [],
            },
            {
                kind: 'turn-finish',
                turnId,
                iterations: 1,
                outputText: 'done',
            },
        ])
        expect(agent.getHistory()).toEqual([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'done' },
        ])
    })

    test('runTurn loops until a tool-free model response is returned', async () => {
        const { tool, execute } = createTool('echo', async (params) => {
            return `tool:${JSON.stringify(params)}`
        })
        const toolCall: ToolCallMessage = {
            role: 'tool-call',
            id: 'call-1',
            name: 'echo',
            arguments: '{"value":"x"}',
        }
        const { calls, provider } = createProvider([
            createResponse(
                {
                    role: 'assistant',
                    content: 'working',
                },
                [toolCall],
                'tool-call'
            ),
            createResponse({
                role: 'assistant',
                content: 'done',
            }),
        ])
        const events: AgentEvent[] = []
        const agent = new Agent(
            {
                provider,
                modelConfig,
            },
            [tool],
            (event) => events.push(event)
        )

        await agent.runTurn('hello')

        expect(execute).toHaveBeenCalledWith({ value: 'x' })
        expect(calls).toEqual([
            {
                messages: [{ role: 'user', content: 'hello' }],
                config: modelConfig,
                tools: [
                    {
                        name: 'echo',
                        description: 'echo description',
                        schema: { type: 'object' },
                    },
                ],
            },
            {
                messages: [
                    { role: 'user', content: 'hello' },
                    { role: 'assistant', content: 'working' },
                    toolCall,
                    {
                        role: 'tool-result',
                        id: 'call-1',
                        content: 'tool:{"value":"x"}',
                    },
                ],
                config: modelConfig,
                tools: [
                    {
                        name: 'echo',
                        description: 'echo description',
                        schema: { type: 'object' },
                    },
                ],
            },
        ])
        expect(events.map((event) => event.kind)).toEqual([
            'turn-start',
            'subturn-start',
            'model-finish',
            'subturn-start',
            'model-finish',
            'turn-finish',
        ])
        expect(events[5]).toEqual({
            kind: 'turn-finish',
            turnId,
            iterations: 2,
            outputText: 'done',
        })
    })

    test('runTurn executes multiple tool calls sequentially and preserves result order', async () => {
        const order: string[] = []
        const { tool: firstTool } = createTool('first', async (params) => {
            order.push(`first:${JSON.stringify(params)}`)
            return 'first-result'
        })
        const { tool: secondTool } = createTool('second', async (params) => {
            order.push(`second:${JSON.stringify(params)}`)
            return 'second-result'
        })
        const firstCall: ToolCallMessage = {
            role: 'tool-call',
            id: 'call-1',
            name: 'first',
            arguments: '{"value":1}',
        }
        const secondCall: ToolCallMessage = {
            role: 'tool-call',
            id: 'call-2',
            name: 'second',
            arguments: '{"value":2}',
        }
        const { calls, provider } = createProvider([
            createResponse(
                {
                    role: 'assistant',
                    content: 'use tools',
                },
                [firstCall, secondCall],
                'tool-call'
            ),
            createResponse({
                role: 'assistant',
                content: 'done',
            }),
        ])
        const agent = new Agent(
            {
                provider,
                modelConfig,
            },
            [firstTool, secondTool],
            () => {}
        )

        await agent.runTurn('hello')

        expect(order).toEqual(['first:{"value":1}', 'second:{"value":2}'])
        expect(calls[1]?.messages).toEqual([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'use tools' },
            firstCall,
            secondCall,
            {
                role: 'tool-result',
                id: 'call-1',
                content: 'first-result',
            },
            {
                role: 'tool-result',
                id: 'call-2',
                content: 'second-result',
            },
        ])
    })

    test('runTurn emits an empty output string when the final assistant message has no content', async () => {
        const { provider } = createProvider([
            createResponse({
                role: 'assistant',
            }),
        ])
        const events: AgentEvent[] = []
        const agent = new Agent(
            {
                provider,
                modelConfig,
            },
            [],
            (event) => events.push(event)
        )

        await agent.runTurn('hello')

        expect(events.at(-1)).toEqual({
            kind: 'turn-finish',
            turnId,
            iterations: 1,
            outputText: '',
        })
    })

    test('handleToolCall returns an unknown tool error for missing tools', async () => {
        const { provider } = createProvider([])
        const agent = new Agent(
            {
                provider,
                modelConfig,
            },
            [],
            () => {}
        )

        await expect(
            agent.handleToolCall({
                role: 'tool-call',
                id: 'call-1',
                name: 'missing',
                arguments: '{}',
            })
        ).resolves.toEqual({
            role: 'tool-result',
            id: 'call-1',
            content: "error: unknown tool 'missing'",
        })
    })

    test('handleToolCall returns an invalid json error when arguments cannot be parsed', async () => {
        const { tool } = createTool('echo', async () => 'unused')
        const { provider } = createProvider([])
        const agent = new Agent(
            {
                provider,
                modelConfig,
            },
            [tool],
            () => {}
        )

        const result = await agent.handleToolCall({
            role: 'tool-call',
            id: 'call-1',
            name: 'echo',
            arguments: '{',
        })

        expect(result.role).toBe('tool-result')
        expect(result.id).toBe('call-1')
        expect(result.content).toMatch(/^error: invalid json:/)
    })

    test('handleToolCall returns a tool result when execution succeeds', async () => {
        const { tool, execute } = createTool('echo', async (params) => {
            return `tool:${JSON.stringify(params)}`
        })
        const { provider } = createProvider([])
        const agent = new Agent(
            {
                provider,
                modelConfig,
            },
            [tool],
            () => {}
        )

        await expect(
            agent.handleToolCall({
                role: 'tool-call',
                id: 'call-1',
                name: 'echo',
                arguments: '{"value":"x"}',
            })
        ).resolves.toEqual({
            role: 'tool-result',
            id: 'call-1',
            content: 'tool:{"value":"x"}',
        })
        expect(execute).toHaveBeenCalledWith({ value: 'x' })
    })

    test('handleToolCall returns an unknown execution error when the tool throws', async () => {
        const { tool } = createTool('echo', async () => {
            throw new Error('boom')
        })
        const { provider } = createProvider([])
        const agent = new Agent(
            {
                provider,
                modelConfig,
            },
            [tool],
            () => {}
        )

        await expect(
            agent.handleToolCall({
                role: 'tool-call',
                id: 'call-1',
                name: 'echo',
                arguments: '{"value":"x"}',
            })
        ).resolves.toEqual({
            role: 'tool-result',
            id: 'call-1',
            content: 'error: unknown error executing tool',
        })
    })
})

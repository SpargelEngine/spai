import debug from 'debug'

import {
    AssistantMessage,
    Config,
    Message,
    Provider,
    ToolCallMessage,
    ToolResultMessage,
    ToolSpec,
} from '@spai/core'

const d = debug('spai:agent')

/**
 * @example
 * // import z from 'zod'
 * class GetWeatherTool implements Tool {
 *     readonly schema = z.object({
 *         location: z.string().describe('The city and state, e.g. San Francisco, CA'),
 *     })
 *
 *     getSpec(): ToolSpec {
 *         return {
 *             name: 'get_weather',
 *             description: 'Get weather of a location, the user should supply a location first.',
 *             schema: this.schema.toJSONSchema(),
 *         }
 *     }
 *
 *     async execute(params: unknown): Promise<string> {
 *         const { location } = this.schema.parse(params)
 *         return '24℃'
 *     }
 * }
 */
interface Tool {
    getSpec(): ToolSpec
    execute(params: unknown): Promise<string>
}

export type AgentEvent =
    | { kind: 'turn-start'; turnId: string; prompt: string }
    | {
          kind: 'turn-finish'
          turnId: string
          iterations: number
          outputText: string
      }
    | { kind: 'subturn-start'; turnId: string; iteration: number }
    | {
          kind: 'model-finish'
          turnId: string
          iteration: number
          assistantMessage: AssistantMessage
          toolCallMessages: ToolCallMessage[]
      }

export type EventHandler = (event: AgentEvent) => void

export interface AgentConfig {
    provider: Provider
    modelConfig: Config
}

// NOTE(tianjiao):
// - When an agent is created, the set of tools must be frozen.
//   Rationale: Changing tools will invalidate the entire prefix cache.
export class Agent {
    private history: Message[]
    private readonly toolSpecs: ToolSpec[]
    private readonly nameToTool: Map<string, Tool>

    constructor(
        private config: AgentConfig,
        private readonly tools: Tool[],
        private eventHandler: EventHandler
    ) {
        this.history = []
        this.toolSpecs = []
        this.nameToTool = new Map()
        for (const tool of this.tools) {
            const spec = tool.getSpec()
            this.toolSpecs.push(spec)
            this.nameToTool.set(spec.name, tool)
        }
    }

    // One turn means user gives a prompt, and the agent works until a final `content` is presented to the user.
    async runTurn(prompt: string) {
        const turnId = crypto.randomUUID()

        this.history.push({ role: 'user', content: prompt })

        this.emitEvent({ kind: 'turn-start', turnId, prompt })

        let iteration = 0

        while (true) {
            iteration += 1

            this.emitEvent({ kind: 'subturn-start', turnId, iteration })

            const { assistantMessage, toolCallMessages } =
                await this.config.provider.generate(
                    this.history,
                    this.config.modelConfig,
                    this.toolSpecs
                )

            this.history.push(assistantMessage, ...toolCallMessages)

            this.emitEvent({
                kind: 'model-finish',
                turnId,
                iteration,
                assistantMessage,
                toolCallMessages,
            })

            if (toolCallMessages.length === 0) {
                const outputText = assistantMessage.content ?? ''
                // TODO(tianjiao): Handle thinking.
                this.emitEvent({
                    kind: 'turn-finish',
                    turnId,
                    iterations: iteration,
                    outputText,
                })
                // TODO(tianjiao): Return `TurnResult`.
                return
            }

            const toolResultMessages = await this.runToolBatch(toolCallMessages)
            this.history.push(...toolResultMessages)
        }
    }

    getHistory(): readonly Message[] {
        return this.history
    }

    // TODO(tianjiao): Emit tool call events.
    private async runToolBatch(
        toolCallMessages: ToolCallMessage[]
    ): Promise<ToolResultMessage[]> {
        const resultMessages: ToolResultMessage[] = []
        for (const toolCall of toolCallMessages) {
            const result = await this.handleToolCall(toolCall)
            resultMessages.push(result)
        }
        return resultMessages
    }

    async handleToolCall(
        toolCall: ToolCallMessage
    ): Promise<ToolResultMessage> {
        const tool = this.nameToTool.get(toolCall.name)

        if (tool === undefined) {
            return {
                role: 'tool-result',
                id: toolCall.id,
                content: `error: unknown tool '${toolCall.name}'`,
            }
        }

        let params: unknown

        try {
            params = JSON.parse(toolCall.arguments)
        } catch (error) {
            if (error instanceof SyntaxError) {
                return {
                    role: 'tool-result',
                    id: toolCall.id,
                    content: `error: invalid json: ${error.message}`,
                }
            }
            return {
                role: 'tool-result',
                id: toolCall.id,
                content: `error: unknown error executing tool`,
            }
        }

        try {
            const content = await tool.execute(params)
            return { role: 'tool-result', id: toolCall.id, content }
        } catch (_error) {
            return {
                role: 'tool-result',
                id: toolCall.id,
                content: `error: unknown error executing tool`,
            }
        }
    }

    private emitEvent(event: AgentEvent) {
        d(event)
        this.eventHandler(event)
    }
}

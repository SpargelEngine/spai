import debug from 'debug'

import {
    AssistantMessage,
    Config,
    Message,
    Provider,
    Response,
    ToolCallMessage,
    ToolSpec,
} from '../types'

const d = debug('spai:provider:chat-completion')

interface ChatCompletionsRequest {
    model: string
    messages: ChatCompletionsMessage[]
    tools?: ChatCompletionsTool[]

    // DeepSeek
    thinking?: { type: 'enabled' | 'disabled' }
}

type ChatCompletionsMessage =
    | {
          role: 'user'
          content: string
      }
    | {
          role: 'assistant'
          content?: string
          reasoning_content?: string
          tool_calls?: ChatCompletionsToolCall[]
      }
    | {
          role: 'tool'
          content: string
          tool_call_id: string
      }

interface ChatCompletionsTool {
    type: 'function'
    function: {
        description: string
        name: string
        parameters: object
    }
}

interface ChatCompletionsToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

function toChatCompletions(
    messages: Message[],
    config: Config,
    tools?: ToolSpec[]
): ChatCompletionsRequest {
    const chatCompletionsMessages: ChatCompletionsMessage[] = []

    let lastAssistantMessage: ChatCompletionsMessage | undefined = undefined

    for (const message of messages) {
        switch (message.role) {
            case 'user': {
                chatCompletionsMessages.push({
                    role: 'user',
                    content: message.content,
                })
                break
            }
            case 'assistant': {
                const chatCompletionsMessage: ChatCompletionsMessage = {
                    role: 'assistant',
                    content: message.content,
                    reasoning_content: message.reasoning,
                    tool_calls: undefined,
                }
                lastAssistantMessage = chatCompletionsMessage
                chatCompletionsMessages.push(chatCompletionsMessage)
                break
            }
            case 'tool-call': {
                if (lastAssistantMessage === undefined) {
                    throw Error('tool-call cannot occur before assistant')
                }
                if (lastAssistantMessage.tool_calls === undefined) {
                    lastAssistantMessage.tool_calls = []
                }
                lastAssistantMessage.tool_calls.push({
                    id: message.id,
                    type: 'function',
                    function: {
                        name: message.name,
                        arguments: message.arguments,
                    },
                })
                break
            }
            case 'tool-result': {
                chatCompletionsMessages.push({
                    role: 'tool',
                    tool_call_id: message.id,
                    content: message.content,
                })
                break
            }
        }
    }

    const chatCompletionsTools = tools?.map((toolSpec) => {
        return {
            type: 'function',
            function: {
                description: toolSpec.description,
                name: toolSpec.name,
                parameters: toolSpec.schema,
            },
        } as ChatCompletionsTool
    })

    return {
        model: config.model,
        messages: chatCompletionsMessages,
        tools: chatCompletionsTools,
    }
}

function fromChatCompletions(message: ChatCompletionsMessage): {
    assistantMessage: AssistantMessage
    toolCallMessages: ToolCallMessage[]
} {
    if (message.role !== 'assistant') {
        throw Error(`unsupported role: '${message.role}'`)
    }

    const assistantMessage: AssistantMessage = {
        role: 'assistant',
        reasoning: message.reasoning_content,
        content: message.content,
    }

    const toolCallMessages =
        message.tool_calls?.map((tool_call) => {
            return {
                role: 'tool-call',
                id: tool_call.id,
                name: tool_call.function.name,
                arguments: tool_call.function.arguments,
            } as ToolCallMessage
        }) ?? []

    return { assistantMessage, toolCallMessages }
}

export type ChatCompletionsProviderType = 'general' | 'deepseek'

const debugGen = d.extend('generate')

export class ChatCompletionsProvider implements Provider {
    constructor(
        private providerType: ChatCompletionsProviderType,
        private url: string | URL,
        private apiKey: string
    ) {}

    processRequest(request: ChatCompletionsRequest, config: Config) {
        if (config.thinking !== undefined) {
            switch (this.providerType) {
                case 'deepseek': {
                    request.thinking = {
                        type: config.thinking ? 'enabled' : 'disabled',
                    }
                    break
                }
            }
        }
    }

    async generate(
        messages: Message[],
        config: Config,
        tools?: ToolSpec[]
    ): Promise<Response> {
        const request = toChatCompletions(messages, config, tools)
        this.processRequest(request, config)
        debugGen(request)

        const headers = new Headers()
        headers.append('Content-Type', 'application/json')
        headers.append('Authorization', `Bearer ${this.apiKey}`)
        const response = await fetch(this.url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(request),
        })
        if (response.status !== 200) {
            console.log(response)
            throw Error(`bad response HTTP status code: ${response.status}`)
        }

        const json = await response.json()
        const message = json.choices[0].message
        const { assistantMessage, toolCallMessages } =
            fromChatCompletions(message)

        // TODO(tianjiao): Fill in real finish reason.
        return { assistantMessage, toolCallMessages, finishReason: 'stop' }
    }
}

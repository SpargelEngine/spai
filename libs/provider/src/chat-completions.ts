import debug from 'debug'

import {
    AssistantMessage,
    Config,
    Message,
    Provider,
    Response,
    ToolCall,
    ToolSpec,
} from '@spai/core'

interface ChatCompletionsRequest {
    model: string
    messages: ChatCompletionsMessage[]
    tools?: ChatCompletionsTool[]
    stream?: boolean
    max_tokens?: number

    // DeepSeek
    thinking?: { type: 'enabled' | 'disabled' }
    reasoning_effort?: string
}

type ChatCompletionsMessage =
    | {
          role: 'system'
          content: string
      }
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

// TODO(tianjiao): Find a better design.
function toChatCompletions(
    messages: Message[],
    config: Config,
    tools?: ToolSpec[]
): ChatCompletionsRequest {
    const chatCompletionsMessages: ChatCompletionsMessage[] = []
    for (const message of messages) {
        switch (message.role) {
            case 'system': {
                chatCompletionsMessages.push(message)
                break
            }
            case 'user': {
                chatCompletionsMessages.push(message)
                break
            }
            case 'assistant': {
                chatCompletionsMessages.push({
                    role: 'assistant',
                    content: message.content,
                    reasoning_content: message.reasoning,
                    tool_calls: message.toolCalls?.map((toolCall) => ({
                        id: toolCall.id,
                        type: 'function',
                        function: {
                            name: toolCall.name,
                            arguments: toolCall.arguments,
                        },
                    })),
                })
                break
            }
            case 'tool': {
                chatCompletionsMessages.push({
                    role: 'tool',
                    tool_call_id: message.id,
                    content: message.content,
                })
                break
            }
        }
    }

    return {
        model: config.model,
        messages: chatCompletionsMessages,
        tools: tools?.map(
            (toolSpec): ChatCompletionsTool => ({
                type: 'function',
                function: {
                    description: toolSpec.description,
                    name: toolSpec.name,
                    parameters: toolSpec.schema,
                },
            })
        ),
    }
}

function fromChatCompletions(
    message: ChatCompletionsMessage
): AssistantMessage {
    if (message.role !== 'assistant') {
        throw Error(`unsupported role: '${message.role}'`)
    }

    const assistantMessage: AssistantMessage = {
        role: 'assistant',
        reasoning: message.reasoning_content,
        content: message.content,
        toolCalls: message.tool_calls?.map(
            (tool_call) =>
                ({
                    role: 'tool-call',
                    id: tool_call.id,
                    name: tool_call.function.name,
                    arguments: tool_call.function.arguments,
                }) as ToolCall
        ),
    }
    return assistantMessage
}

export type ChatCompletionsProviderType = 'general' | 'deepseek'

const debugGen = debug('spai:provider:chat-completion').extend('generate')

export class ChatCompletionsProvider implements Provider {
    // TODO(tianjiao): Remove `providerType`.
    // - Switch to a composition API.
    //   Example: `hasReasoningContent` indicates the provider supports DeepSeek-style
    //   reasoning content.
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
        tools?: ToolSpec[],
        signal?: AbortSignal
    ): Promise<Response> {
        const request = toChatCompletions(messages, config, tools)
        this.processRequest(request, config)

        // Record the request sent to providers.
        debugGen(request)

        const response = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(request),
            signal,
        })
        if (response.status !== 200) {
            debugGen(response)
            throw Error(`bad response HTTP status code: ${response.status}`)
        }

        const json = await response.json()

        if (!Array.isArray(json.choices) || json.choices.length === 0) {
            throw Error('response must contain a nonempty choices array')
        }

        // TODO(tianjiao): Fill in real finish reason.
        return {
            message: fromChatCompletions(json.choices[0].message),
            finishReason: 'stop',
            tokenUsage:
                json.usage !== undefined
                    ? {
                          inputTokens: json.usage.prompt_tokens ?? 0,
                          outputTokens: json.usage.completion_tokens ?? 0,
                          cachedTokens: json.usage.prompt_cache_hit_tokens ?? 0,
                          reasoningTokens:
                              json.usage.completion_tokens_details
                                  .reasoning_tokens ?? 0,
                      }
                    : undefined,
        }
    }
}

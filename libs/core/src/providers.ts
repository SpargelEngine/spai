import { ChatItem, Config, Message, Provider, Response, Tool } from './types'

export interface OpenAIChatCompletionsRequest {
    model: string
    messages: OpenAIChatCompletionMessage[]
    thinking?: { type: 'enabled' }
}

export type OpenAIChatCompletionMessage =
    | {
          role: 'user'
          content: string
      }
    | {
          role: 'assistant'
          content?: string
          reasoning_content?: string
          tool_calls?: OpenAIChatCompletionToolCall[]
      }
    | {
          role: 'tool'
          content: string
          tool_call_id: string
      }

export interface OpenAIChatCompletionToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

export function toChatCompletions(
    messages: Message[],
    config: Config
): OpenAIChatCompletionsRequest {
    const chatCompletionsMessages: OpenAIChatCompletionMessage[] = []

    let pendingToolCalls: OpenAIChatCompletionToolCall[] = []
    let pendingReasoning: string | undefined = undefined

    const flushPending = () => {
        if (pendingReasoning !== undefined || pendingToolCalls.length !== 0) {
            chatCompletionsMessages.push({
                role: 'assistant',
                content: '',
                reasoning_content: pendingReasoning,
                tool_calls: pendingToolCalls,
            })
        }

        pendingReasoning = undefined
        pendingToolCalls = []
    }

    for (const message of messages) {
        for (const item of message.items) {
            switch (item.type) {
                case 'reasoning': {
                    flushPending()
                    pendingReasoning = item.content
                    break
                }
                case 'input-text': {
                    flushPending()
                    chatCompletionsMessages.push({
                        role: 'user',
                        content: item.content,
                    })
                    break
                }
                case 'output-text': {
                    const chatCompletionsMessage: OpenAIChatCompletionMessage =
                        {
                            role: 'assistant',
                            content: item.content,
                            reasoning_content: undefined,
                            tool_calls: undefined,
                        }
                    if (pendingReasoning !== undefined) {
                        chatCompletionsMessage.reasoning_content =
                            pendingReasoning
                        pendingReasoning = undefined
                    }
                    if (pendingToolCalls.length !== 0) {
                        chatCompletionsMessage.tool_calls = pendingToolCalls
                        pendingToolCalls = []
                    }
                    chatCompletionsMessages.push(chatCompletionsMessage)
                    break
                }
                case 'tool-call': {
                    pendingToolCalls.push({
                        id: item.id,
                        type: 'function',
                        function: {
                            name: item.name,
                            arguments: item.arguments,
                        },
                    })
                    break
                }
                case 'tool-result': {
                    flushPending()
                    chatCompletionsMessages.push({
                        role: 'tool',
                        tool_call_id: item.id,
                        content: item.content,
                    })
                    break
                }
            }
        }

        flushPending()
    }

    return { model: config.model, messages: chatCompletionsMessages }
}

export function fromChatCompletions(
    message: OpenAIChatCompletionMessage
): Message {
    const items: ChatItem[] = []
    if (message.role !== 'assistant') {
        throw Error('unsupported role')
    }
    if (message.reasoning_content !== undefined) {
        items.push({
            type: 'reasoning',
            content: message.reasoning_content,
        })
    }
    if (message.tool_calls !== undefined) {
        for (const tool_call of message.tool_calls) {
            items.push({
                type: 'tool-call',
                id: tool_call.id,
                name: tool_call.function.name,
                arguments: tool_call.function.arguments,
            })
        }
    }
    if (message.content !== undefined) {
        items.push({
            type: 'output-text',
            content: message.content,
        })
    }
    return { items }
}

const DEEPSEEK_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner'])

export class DeepSeekProvider implements Provider {
    async generate(
        messages: Message[],
        config: Config,
        _tools?: Tool[]
    ): Promise<Response> {
        // validate config
        if (!DEEPSEEK_MODELS.has(config.model)) {
            throw Error('unknown model: ' + config.model)
        }

        const request = toChatCompletions(messages, config)

        if (config.thinking) {
            request.thinking = { type: 'enabled' }
        }

        console.log(request)

        const headers = new Headers()
        headers.append('Content-Type', 'application/json')
        headers.append('Authorization', `Bearer ${config.api_key}`)
        const response = await fetch(
            new URL('/chat/completions', config.base_url),
            {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(request),
            }
        )
        if (response.status !== 200) {
            console.log(response)
            throw Error('bad response')
        }
        const json = await response.json()
        const message = json.choices[0].message
        return { message: fromChatCompletions(message) }
    }
}

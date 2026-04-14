import {
    AssistantMessage,
    Config,
    Message,
    Provider,
    Response,
    ToolCallMessage,
    ToolSpec,
} from '../types'

interface ChatCompletionsRequest {
    model: string
    messages: ChatCompletionMessage[]
    thinking?: { type: 'enabled' }
}

type ChatCompletionMessage =
    | {
          role: 'user'
          content: string
      }
    | {
          role: 'assistant'
          content?: string
          reasoning_content?: string
          tool_calls?: ChatCompletionToolCall[]
      }
    | {
          role: 'tool'
          content: string
          tool_call_id: string
      }

interface ChatCompletionToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

function toChatCompletions(
    messages: Message[],
    config: Config
): ChatCompletionsRequest {
    const chatCompletionsMessages: ChatCompletionMessage[] = []

    let lastAssistant: ChatCompletionMessage | undefined = undefined

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
                const chatCompletionsMessage: ChatCompletionMessage = {
                    role: 'assistant',
                    content: message.content,
                    reasoning_content: message.reasoning,
                    tool_calls: undefined,
                }
                lastAssistant = chatCompletionsMessage
                chatCompletionsMessages.push(chatCompletionsMessage)
                break
            }
            case 'tool-call': {
                if (lastAssistant === undefined) {
                    throw Error('tool-call cannot occur before assistant')
                }
                if (lastAssistant.tool_calls === undefined) {
                    lastAssistant.tool_calls = []
                }
                lastAssistant.tool_calls.push({
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

    return { model: config.model, messages: chatCompletionsMessages }
}

function fromChatCompletions(message: ChatCompletionMessage): {
    assistantMessage: AssistantMessage
    toolCallMessages: ToolCallMessage[]
} {
    const assistantMessage: AssistantMessage = {
        role: 'assistant',
    }
    const toolCallMessages: ToolCallMessage[] = []
    if (message.role !== 'assistant') {
        throw Error('unsupported role')
    }
    assistantMessage.reasoning = message.reasoning_content
    assistantMessage.content = message.content
    if (message.tool_calls !== undefined) {
        for (const tool_call of message.tool_calls) {
            toolCallMessages.push({
                role: 'tool-call',
                id: tool_call.id,
                name: tool_call.function.name,
                arguments: tool_call.function.arguments,
            })
        }
    }
    return { assistantMessage, toolCallMessages }
}

export class DeepSeekProvider implements Provider {
    constructor(
        private baseUrl: string | URL,
        private apiKey: string
    ) {}

    async generate(
        messages: Message[],
        config: Config,
        _tools?: ToolSpec[]
    ): Promise<Response> {
        const request = toChatCompletions(messages, config)

        if (config.thinking) {
            request.thinking = { type: 'enabled' }
        }

        console.log(request)

        const headers = new Headers()
        headers.append('Content-Type', 'application/json')
        headers.append('Authorization', `Bearer ${this.apiKey}`)
        const response = await fetch(
            new URL('/chat/completions', this.baseUrl),
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
        const { assistantMessage, toolCallMessages } =
            fromChatCompletions(message)

        // TODO(tianjiao): Fill in real finish reason.
        return { assistantMessage, toolCallMessages, finishReason: 'stop' }
    }
}

export type UserMessage = { role: 'user'; content: string }

export type AssistantMessage = {
    role: 'assistant'
    content?: string
    reasoning?: string
    signature?: string
}

export type ToolCallMessage = {
    role: 'tool-call'
    id: string
    name: string
    arguments: string
}

export type ToolResultMessage = {
    role: 'tool-result'
    id: string
    content: string
}

export type Message =
    | UserMessage
    | AssistantMessage
    | ToolCallMessage
    | ToolResultMessage

export type FinishReason = 'stop' | 'length' | 'tool-call' | 'error'

export interface Response {
    assistantMessage: AssistantMessage
    toolCallMessages: ToolCallMessage[]
    tokenUsage?: TokenUsage
    finishReason: FinishReason
}

export interface TokenUsage {
    inputTokens: number
    outputTokens: number
}

export interface Tool {
    name: string
    description: string
    parameters: object // json-schema
}

export interface Config {
    model: string
    thinking: boolean
}

export interface Provider {
    generate(
        messages: Message[],
        config: Config,
        tools?: Tool[]
    ): Promise<Response>
}

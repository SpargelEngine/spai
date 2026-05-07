export type UserMessage = { role: 'user'; content: string }

export type AssistantMessage = {
    role: 'assistant'
    content?: string
    reasoning?: string
    toolCalls?: ToolCall[]
}

export type ToolCall = {
    id: string
    name: string
    arguments: string
}

export type ToolMessage = {
    role: 'tool'
    id: string
    content: string
}

export type Message = UserMessage | AssistantMessage | ToolMessage

export type FinishReason = 'stop' | 'length' | 'tool-call' | 'error'

export interface Response {
    message: AssistantMessage
    tokenUsage?: TokenUsage
    finishReason: FinishReason
}

export interface TokenUsage {
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    reasoningTokens: number
}

export interface ToolSpec {
    name: string
    description: string
    // TODO(tianjiao): Use a typed version for json-schema objects.
    schema: object // json-schema
}

export type ThinkingEffort = 'high' | 'max'

export interface Config {
    model: string
    thinking?: boolean
    thinkingEffort?: ThinkingEffort
}

export interface Provider {
    generate(
        messages: Message[],
        config: Config,
        tools?: ToolSpec[]
    ): Promise<Response>
}

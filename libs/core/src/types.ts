export type ChatItem =
    | {
          type: 'reasoning'
          content: string
          encrypted?: string
      }
    | { type: 'input-text'; content: string }
    | { type: 'output-text'; content: string }
    | { type: 'tool-call'; id: string; name: string; arguments: string }
    | { type: 'tool-result'; id: string; content: string }

export interface Message {
    items: ChatItem[]
}

export interface Response {
    message: Message
    token_usage?: TokenUsage
}

export interface TokenUsage {
    input_tokens: number
    output_tokens: number
}

export interface Config {
    model: string
    base_url: string
    api_key: string
    thinking: boolean
}

export interface Provider {
    generate(
        messages: Message[],
        config: Config,
        tools?: Tool[]
    ): Promise<Response>
}

export type FinishReason = 'stop' | 'length' | 'tool-call' | 'error'

export interface Tool {
    name: string
    description: string
    parameters: object // json-schema
}

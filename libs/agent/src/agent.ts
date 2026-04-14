import * as z from 'zod'

import {
    Message,
    Provider,
    ToolCallMessage,
    ToolResultMessage,
} from '@spai/core'

export type ToolSpec<TInput> = {
    name: string
    description: string
    inputSchema: z.ZodType<TInput>
}

export interface Tool<TInput> {
    readonly spec: ToolSpec<TInput>
    execute: (params: TInput) => Promise<string>
}

export class ToolRegistry {
    async handleToolCall(
        toolCall: ToolCallMessage
    ): Promise<ToolResultMessage> {
        // TODO(tianjiao): Invoke tools.
        return { role: 'tool-result', id: toolCall.id, content: '(none)' }
    }
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
    | { kind: 'model-finish'; turnId: string; iteration: number }

export type EventHandler = (event: AgentEvent) => void

// NOTE(tianjiao):
// - When an agent is created, the set of tools must be frozen.
//   Rationale: Changing tools will invalidate the entire prefix cache.
export class Agent {
    private history: Message[]

    constructor(
        private provider: Provider,
        private toolRegistry: ToolRegistry,
        private eventHandler: EventHandler
    ) {
        this.history = []
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

            // TODO(tianjiao):
            // - Move config into `ModelClient` which bundles `Provider` and `Config`.
            // - Support tool calls.
            const { assistantMessage, toolCallMessages } =
                await this.provider.generate(this.history, {
                    model: 'deepseek-chat',
                    thinking: true,
                })

            this.history.push(assistantMessage, ...toolCallMessages)

            this.emitEvent({ kind: 'model-finish', turnId, iteration })

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

    private async runToolBatch(
        toolCallMessages: ToolCallMessage[]
    ): Promise<ToolResultMessage[]> {
        const resultMessages: ToolResultMessage[] = []
        for (const toolCall of toolCallMessages) {
            const result = await this.toolRegistry.handleToolCall(toolCall)
            resultMessages.push(result)
        }
        return resultMessages
    }

    private emitEvent(event: AgentEvent) {
        this.eventHandler(event)
    }
}

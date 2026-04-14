import {
    Message,
    Provider,
    ToolCallMessage,
    ToolResultMessage,
    ToolSpec,
} from '@spai/core'

// Example:
// ```
// class WeatherTool implements Tool {
//     readonly schema = z.object({ city: z.string() })
//
//     getSpec(): ToolSpec {
//         return {
//             name: 'get-weather',
//             description: '...',
//             schema: this.schema.toJSONSchema(),
//         }
//     }
//     async execute(params: unknown): Promise<string> {
//         const { city } = this.schema.parse(params)
//         return city
//     }
// }
// ```
interface Tool {
    getSpec(): ToolSpec
    execute(params: unknown): Promise<string>
}

export class ToolRegistry {
    readonly specs: ToolSpec[]

    constructor(private readonly tools: Tool[]) {
        this.specs = []
        for (const tool of this.tools) {
            this.specs.push(tool.getSpec())
        }
    }

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

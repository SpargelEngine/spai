import z from 'zod'

const providerSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('chat-completions'),

        subType: z.enum(['general', 'deepseek']).default('general'),
        url: z.string(),
    }),
])

export const cliConfigSchema = z.object({
    apiKey: z.string(),

    model: z.string(),
    thinking: z.boolean().optional(),

    showReasoning: z.boolean().default(false),
    showToolCalls: z.boolean().default(false),

    systemPrompt: z.string().optional(),
    systemPromptFile: z.string().optional(),

    defaultProvider: z.string(),
    providers: z.record(z.string(), providerSchema),
})

export type CLIConfig = z.infer<typeof cliConfigSchema>

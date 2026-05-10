import z from 'zod'

export const cliConfigSchema = z.object({
    apiKey: z.string(),

    model: z.string(),
    thinking: z.boolean().optional(),

    systemPrompt: z.string().optional(),
    systemPromptFile: z.string().optional(),

    provider: z.discriminatedUnion('type', [
        z.object({
            type: z.literal('chat-completions'),

            subType: z.enum(['general', 'deepseek']).default('general'),
            url: z.string(),
        }),
    ]),
})

export type CLIConfig = z.infer<typeof cliConfigSchema>

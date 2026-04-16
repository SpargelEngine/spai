import z from 'zod'

export const cliConfigSchema = z.object({
    apiKeyFile: z.string(),

    model: z.string(),
    thinking: z.boolean().optional(),

    provider: z.discriminatedUnion('type', [
        z.object({
            type: z.literal('chat-completions'),

            subType: z.enum(['general', 'deepseek']).default('general'),
            url: z.string(),
        }),
    ]),
})

export type CLIConfig = z.infer<typeof cliConfigSchema>

import process from 'node:process'
import readline from 'node:readline/promises'

import { Config, Message, Provider, Response } from '@spai/core'
import { DeepSeekProvider } from '@spai/core'

const EXIT_COMMANDS = new Set([':q', ':quit', ':exit'])

function printWelcome() {
    console.log('hint: Type a message and press enter. Type ":q" to quit.')
}

function printResponse(response: Response) {
    const { assistantMessage, toolCallMessages } = response
    if (assistantMessage.reasoning !== undefined) {
        console.log(`[reasoning]\n${assistantMessage.reasoning}\n`)
    }
    if (assistantMessage.content !== undefined) {
        console.log(`[assistant]\n${assistantMessage.content}\n`)
    }
    for (const toolCall of toolCallMessages) {
        console.log(`[tool-call]\n ${toolCall.name}(${toolCall.arguments})\n`)
    }
}

async function runChatCli(provider: Provider) {
    const config: Config = {
        model: 'deepseek-chat',
        thinking: true,
    }

    let statusLine = `Model: ${config.model}`
    if (config.thinking) {
        statusLine += ' (thinking)'
    }

    console.log(statusLine)

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })
    const history: Message[] = []

    printWelcome()

    try {
        while (true) {
            const input = (await rl.question('[you]\n')).trim()
            if (input === '') {
                continue
            }
            if (EXIT_COMMANDS.has(input.toLowerCase())) {
                break
            }

            history.push({
                role: 'user',
                content: input,
            })

            const response = await provider.generate(history, config)
            history.push(
                response.assistantMessage,
                ...response.toolCallMessages
            )

            printResponse(response)
        }
    } finally {
        rl.close()
    }
}

async function main() {
    const apiKey = process.env.DEEPSEEK_API_KEY ?? '<DUMMY>'
    await runChatCli(new DeepSeekProvider('https://api.deepseek.com', apiKey))
}

void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})

import process from 'node:process'
import readline from 'node:readline/promises'

import { ChatItem, Config, Message, Provider } from './types'
import { DeepSeekProvider } from './providers'

const EXIT_COMMANDS = new Set([':q', ':quit', ':exit'])

function printWelcome() {
    console.log('hint: Type a message and press enter. Type ":q" to quit.')
}

function printResponse(items: ChatItem[]) {
    for (const item of items) {
        switch (item.type) {
            case 'reasoning':
                if (item.content.trim() !== '') {
                    console.log(`[reasoning]\n${item.content}`)
                }
                break
            case 'output-text':
                console.log(`[assistant]\n ${item.content}`)
                break
            case 'tool-call':
                console.log(`[tool-call]\n ${item.name}(${item.arguments})`)
                break
            case 'tool-result':
                console.log(`[tool-result]\n ${item.content}`)
                break
            case 'input-text':
                break
        }
        console.log('')
    }
}

async function runChatCli(provider: Provider) {
    const api_key = process.env.DEEPSEEK_API_KEY ?? '<DUMMY>'
    const config: Config = {
        model: 'deepseek-chat',
        base_url: 'https://api.deepseek.com',
        api_key: api_key,
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
                items: [
                    {
                        type: 'input-text',
                        content: input,
                    },
                ],
            })

            const response = await provider.generate(history, config)
            history.push(response.message)

            printResponse(response.message.items)
        }
    } finally {
        rl.close()
    }
}

async function main() {
    await runChatCli(new DeepSeekProvider())
}

void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})

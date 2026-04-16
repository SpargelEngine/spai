import fs from 'node:fs'
import process from 'node:process'
import readline from 'node:readline/promises'

import { Config, Message, Provider, Response } from '@spai/core'
import { ChatCompletionsProvider } from '@spai/core'

import { cliConfigSchema } from './config'

function printWelcome() {
    console.log('hint: Type a message and press enter. Type ":q" to quit.')
}

function printResponse({ assistantMessage, toolCallMessages }: Response) {
    console.log('================')

    if (assistantMessage.reasoning !== undefined) {
        console.log(`[reasoning]\n${assistantMessage.reasoning}\n`)
    }
    if (assistantMessage.content !== undefined) {
        console.log(`[assistant]\n${assistantMessage.content}\n`)
    }
    for (const toolCall of toolCallMessages) {
        console.log(`[tool-call]\n ${toolCall.name}(${toolCall.arguments})\n`)
    }

    console.log('================')
}

async function runChatCli(provider: Provider, config: Config) {
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
            const input = (await rl.question('[user] > ')).trim()

            if (input === '') {
                continue
            }

            if (input.startsWith(':')) {
                const components = input.slice(1).split(' ')

                if (components.length > 0) {
                    const cmd = components[0]
                    const _args = components.slice(1)

                    if (new Set(['q', 'quit', 'exit']).has(cmd)) {
                        break
                    } else if (cmd === 'history') {
                        console.log(history)
                    }
                }

                continue
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
    if (process.argv.length <= 2) {
        console.log(`Usage: node ${process.argv[1]} <config.json>`)
        process.exitCode = 1
        return
    }

    const config = cliConfigSchema.parse(
        JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
    )

    let provider: Provider
    switch (config.provider.type) {
        case 'chat-completions': {
            provider = new ChatCompletionsProvider(
                config.provider.subType,
                config.provider.url,
                fs.readFileSync(config.apiKeyFile, 'utf8').trim()
            )
            break
        }
    }

    const modelConfig: Config = {
        model: config.model,
        thinking: config.thinking,
    }

    await runChatCli(provider, modelConfig)
}

void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})

import fs from 'node:fs'
import process from 'node:process'
import readline from 'node:readline/promises'

import { Agent, AgentEvent } from '@spai/agent'
import { ChatCompletionsProvider, Config, Provider } from '@spai/core'

import { cliConfigSchema } from './config'

const EXIT_COMMANDS = new Set(['q', 'quit', 'exit'])

function printWelcome() {
    console.log('hint: Type a message and press enter. Type ":q" to quit.')
}

function printAgentEvent(event: AgentEvent) {
    if (event.kind !== 'model-finish') {
        return
    }

    const { message } = event
    console.log('================')
    if (message.reasoning !== undefined) {
        console.log(`[reasoning]\n${message.reasoning}\n`)
    }
    if (message.content !== undefined) {
        console.log(`[assistant]\n${message.content}\n`)
    }
    message.toolCalls?.forEach((toolCall) => {
        console.log(`[tool-call]\n ${toolCall.name}(${toolCall.arguments})\n`)
    })

    console.log('================')
}

async function runChatCli(agent: Agent, config: Config) {
    let statusLine = `Model: ${config.model}`
    if (config.thinking) {
        statusLine += ' (thinking)'
    }

    console.log(statusLine)

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

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

                    if (EXIT_COMMANDS.has(cmd)) {
                        break
                    } else if (cmd === 'history') {
                        console.log(agent.getHistory())
                    }
                }

                continue
            }

            await agent.runTurn(input)
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

    const cliConfig = cliConfigSchema.parse(
        JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
    )

    const provider: Provider = (() => {
        switch (cliConfig.provider.type) {
            case 'chat-completions':
                return new ChatCompletionsProvider(
                    cliConfig.provider.subType,
                    cliConfig.provider.url,
                    fs.readFileSync(cliConfig.apiKeyFile, 'utf8').trim()
                )
        }
    })()

    const config: Config = {
        model: cliConfig.model,
        thinking: cliConfig.thinking,
    }
    const agent = new Agent(
        {
            provider,
            modelConfig: config,
        },
        [],
        printAgentEvent
    )
    await runChatCli(agent, config)
}

void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})

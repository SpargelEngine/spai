import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline/promises'

import { Agent, AgentEvent, BashTool, EditFileTool } from '@spai/agent'
import { Config, Provider } from '@spai/core'
import { ChatCompletionsProvider } from '@spai/provider'

import { cliConfigSchema } from './config'

const EXIT_COMMANDS = new Set(['q', 'quit', 'exit'])

function printWelcome() {
    console.log('hint: Type a message and press enter. Type ":q" to quit.\n')
}

let totalInputTokens = 0
let totalOutputTokens = 0
let totalCachedTokens = 0

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function printAgentEvent(
    event: AgentEvent,
    showReasoning: boolean,
    showToolCalls: boolean,
    color: boolean
) {
    if (event.kind === 'subturn-start') {
        console.log('----')
        return
    }

    if (event.kind !== 'model-finish') {
        return
    }

    const { message } = event

    // Reasoning
    if (message.reasoning !== undefined) {
        if (color) process.stdout.write(DIM)
        if (showReasoning) {
            console.log(`[reasoning]\n${message.reasoning}\n`)
        } else {
            console.log(`[reasoning] (...) \n`)
        }
        if (color) process.stdout.write(RESET)
    }

    // Assistant Message
    if (message.content !== undefined && message.content !== '') {
        console.log(`[assistant]\n${message.content}\n`)
    }

    // Tool Calls
    if (message.toolCalls && message.toolCalls.length > 0) {
        if (color) process.stdout.write(DIM)
        if (showToolCalls) {
            console.log('[tool-call]')
            message.toolCalls.forEach((toolCall) => {
                console.log(`  ${toolCall.name}(${toolCall.arguments})\n`)
            })
        } else {
            const counts = new Map<string, number>()
            for (const toolCall of message.toolCalls) {
                counts.set(toolCall.name, (counts.get(toolCall.name) ?? 0) + 1)
            }
            const parts: string[] = []
            for (const [name, count] of counts) {
                parts.push(`${name} (${count})`)
            }
            console.log(`[tool-call] ${parts.join(', ')}\n`)
        }
        if (color) process.stdout.write(RESET)
    }

    if (event.tokenUsage !== undefined) {
        totalInputTokens += event.tokenUsage.inputTokens
        totalOutputTokens += event.tokenUsage.outputTokens
        totalCachedTokens += event.tokenUsage.cachedTokens
    }
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
            console.log('========')

            const input = (await rl.question('[user] > ')).trim()
            console.log('')

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

function asPercent(num: number) {
    return (num * 100).toFixed(1) + '%'
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

    const providerConfig = cliConfig.providers[cliConfig.defaultProvider]
    if (!providerConfig) {
        throw new Error(
            `defaultProvider '${cliConfig.defaultProvider}' not found in providers`
        )
    }

    let provider: Provider
    switch (providerConfig.type) {
        case 'chat-completions':
            provider = new ChatCompletionsProvider(
                providerConfig.subType,
                providerConfig.url,
                cliConfig.apiKey
            )
            break
    }

    let systemPrompt = ''
    systemPrompt += `Current working directory: ${process.cwd()}`

    const agentsMdPath = path.join(process.cwd(), 'AGENTS.md')
    if (fs.existsSync(agentsMdPath)) {
        const agentsMdContent = fs.readFileSync(agentsMdPath, 'utf8')
        systemPrompt += '\nAGENTS.md:\n' + agentsMdContent
        console.log(`[info] Loaded AGENTS.md as system prompt supplement`)
    }

    const config: Config = {
        model: cliConfig.model,
        thinking: cliConfig.thinking,
    }
    const showReasoning = cliConfig.showReasoning
    const showToolCalls = cliConfig.showToolCalls
    const color = cliConfig.color
    const agent = new Agent(
        {
            provider,
            modelConfig: config,
        },
        [new BashTool(), new EditFileTool()],
        [
            {
                role: 'system',
                content: systemPrompt,
            },
        ],
        (event) => printAgentEvent(event, showReasoning, showToolCalls, color)
    )
    await runChatCli(agent, config)

    console.log('====================')
    const cacheHitRate = totalCachedTokens / totalInputTokens
    console.log(
        `input = ${totalInputTokens}, output = ${totalOutputTokens}, cache hit = ${asPercent(cacheHitRate)}`
    )
}

void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})

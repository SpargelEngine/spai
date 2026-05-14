import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline/promises'

import { Agent, BashTool, EditFileTool } from '@spai/agent'
import {
    AssistantMessage,
    Config,
    Provider,
    Session,
    TokenUsage,
} from '@spai/core'
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

function onSubturnStart(_event: {
    kind: 'subturn-start'
    turnId: string
    iteration: number
}) {
    console.log('----')
}

function onModelFinish(
    event: {
        kind: 'model-finish'
        turnId: string
        iteration: number
        message: AssistantMessage
        tokenUsage?: TokenUsage
    },
    showReasoning: boolean,
    showToolCalls: boolean,
    color: boolean
) {
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
    console.log(`Model: ${config.model}${config.thinking ? ' (thinking)' : ''}`)

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

function assembleSystemPrompt(): string {
    let prompt = ''

    const globalAgentsMdPath = path.join(
        os.homedir(),
        '.config',
        'spai',
        'AGENTS.md'
    )
    if (fs.existsSync(globalAgentsMdPath)) {
        prompt += fs.readFileSync(globalAgentsMdPath, 'utf8') + '\n'
        console.log(
            `[info] Loaded ~/.config/spai/AGENTS.md as system prompt supplement`
        )
    }

    const agentsMdPath = path.join(process.cwd(), 'AGENTS.md')
    if (fs.existsSync(agentsMdPath)) {
        prompt += '\nAGENTS.md:\n' + fs.readFileSync(agentsMdPath, 'utf8')
        console.log(`[info] Loaded AGENTS.md as system prompt supplement`)
    }

    const localAgentsMdPath = path.join(process.cwd(), 'AGENTS.local.md')
    if (fs.existsSync(localAgentsMdPath)) {
        prompt +=
            '\nAGENTS.local.md:\n' + fs.readFileSync(localAgentsMdPath, 'utf8')
        console.log(`[info] Loaded AGENTS.local.md as system prompt supplement`)
    }

    // Inject dynamic context after AGENTS.md contents
    prompt += `\nCurrent working directory: ${process.cwd()}`
    prompt += `\nCurrent date/time: ${new Date().toISOString()}`
    prompt += `\nSystem: ${os.hostname()} / ${os.platform()} ${os.release()} (${os.arch()})`

    return prompt
}

async function main() {
    let configPath: string

    if (process.argv.length > 2) {
        configPath = process.argv[2]
    } else {
        configPath = path.join(os.homedir(), '.config', 'spai', 'config.json')
    }

    if (!fs.existsSync(configPath)) {
        console.error(
            `Config file not found: ${configPath}\n` +
                `Pass a config file as argument or place it at ~/.config/spai/config.json`
        )
        process.exitCode = 1
        return
    }

    const cliConfig = cliConfigSchema.parse(
        JSON.parse(fs.readFileSync(configPath, 'utf8'))
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

    const config: Config = {
        model: cliConfig.model,
        thinking: cliConfig.thinking,
    }
    const agent = new Agent(
        {
            provider,
            modelConfig: config,
        },
        [new BashTool(), new EditFileTool()],
        new Session([
            {
                role: 'system',
                content: assembleSystemPrompt(),
            },
        ])
    )
    agent.on('subturn-start', (event) => onSubturnStart(event))
    agent.on('model-finish', (event) =>
        onModelFinish(
            event,
            cliConfig.showReasoning,
            cliConfig.showToolCalls,
            cliConfig.color
        )
    )
    await runChatCli(agent, config)

    console.log('====================')
    console.log(
        `input = ${totalInputTokens}, output = ${totalOutputTokens}, cache hit = ${asPercent(totalCachedTokens / totalInputTokens)}`
    )
}

void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})

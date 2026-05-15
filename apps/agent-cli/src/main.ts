import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { Agent, BashTool, EditFileTool } from '@spai/agent'
import {
    AssistantMessage,
    Config,
    Message,
    Provider,
    Session,
    TokenUsage,
} from '@spai/core'
import { ChatCompletionsProvider } from '@spai/provider'

import { type CLIConfig, cliConfigSchema } from './config'
import { Terminal } from './terminal'
import { UI } from './ui'

const EXIT_COMMANDS = new Set(['q', 'quit', 'exit'])

let totalInputTokens = 0
let totalOutputTokens = 0
let totalCachedTokens = 0

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

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
): string[] {
    const { message } = event
    const lines: string[] = []

    // Reasoning
    if (message.reasoning !== undefined) {
        if (showReasoning) {
            lines.push(
                ...dimLines(
                    ['[reasoning]', ...splitLines(message.reasoning), ''],
                    color
                )
            )
        } else {
            lines.push(...dimLines(['[reasoning] (...)', ''], color))
        }
    }

    // Assistant Message
    if (message.content !== undefined && message.content !== '') {
        lines.push('[assistant]', ...splitLines(message.content), '')
    }

    // Tool Calls
    if (message.toolCalls && message.toolCalls.length > 0) {
        if (showToolCalls) {
            const toolCallLines = ['[tool-call]']
            message.toolCalls.forEach((toolCall) => {
                toolCallLines.push(
                    `  ${toolCall.name}(${toolCall.arguments})`,
                    ''
                )
            })
            lines.push(...dimLines(toolCallLines, color))
        } else {
            const counts = new Map<string, number>()
            for (const toolCall of message.toolCalls) {
                counts.set(toolCall.name, (counts.get(toolCall.name) ?? 0) + 1)
            }
            const parts: string[] = []
            for (const [name, count] of counts) {
                parts.push(`${name} (${count})`)
            }
            lines.push(
                ...dimLines([`[tool-call] ${parts.join(', ')}`, ''], color)
            )
        }
    }

    if (event.tokenUsage !== undefined) {
        totalInputTokens += event.tokenUsage.inputTokens
        totalOutputTokens += event.tokenUsage.outputTokens
        totalCachedTokens += event.tokenUsage.cachedTokens
    }

    return lines
}

function splitLines(text: string): string[] {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function dimLines(lines: string[], color: boolean): string[] {
    if (!color || lines.length === 0) return lines

    const dimmed = [...lines]
    dimmed[0] = DIM + dimmed[0]
    dimmed[dimmed.length - 1] += RESET
    return dimmed
}

function formatHistory(messages: readonly Message[]): string[] {
    return splitLines(JSON.stringify(messages, null, 2))
}

async function runChatCli(agent: Agent, config: Config, cliConfig: CLIConfig) {
    const terminal = new Terminal()
    const pendingInputs: string[] = []
    let inputResolver: ((input: string | undefined) => void) | undefined
    let exitRequested = false
    let activeAbortController: AbortController | undefined

    const waitForInput = async (): Promise<string | undefined> => {
        if (exitRequested) return undefined

        const pendingInput = pendingInputs.shift()
        if (pendingInput !== undefined) {
            return pendingInput
        }

        return await new Promise((resolve) => {
            inputResolver = resolve
        })
    }

    const submitInput = (input: string) => {
        const trimmedInput = input.trim()
        if (inputResolver !== undefined) {
            const resolve = inputResolver
            inputResolver = undefined
            resolve(trimmedInput)
            return
        }

        pendingInputs.push(trimmedInput)
    }

    const requestExit = () => {
        exitRequested = true
        if (inputResolver !== undefined) {
            const resolve = inputResolver
            inputResolver = undefined
            resolve(undefined)
        }
    }

    const ui = new UI(terminal, {
        onSubmit: submitInput,
    })

    const append = (lines: string[]) => {
        ui.append(lines)
    }

    const handleModelFinish = (event: {
        kind: 'model-finish'
        turnId: string
        iteration: number
        message: AssistantMessage
        tokenUsage?: TokenUsage
    }) => {
        append(
            onModelFinish(
                event,
                cliConfig.showReasoning,
                cliConfig.showToolCalls,
                cliConfig.color
            )
        )
    }

    const handleTerminalPieces = (pieces: string[]) => {
        for (const piece of pieces) {
            if (piece !== '\x03') continue

            if (
                activeAbortController !== undefined &&
                !activeAbortController.signal.aborted
            ) {
                activeAbortController.abort()
                append(['[interrupted]'])
            } else if (activeAbortController === undefined) {
                requestExit()
            }
        }
    }

    terminal.start()
    ui.start()
    terminal.on('pieces', handleTerminalPieces)
    agent.on('model-finish', handleModelFinish)

    append([
        `Model: ${config.model}${config.thinking ? ' (thinking)' : ''}`,
        '',
        'hint: Type a message and press Enter. Type ":q" to quit.',
        '',
    ])

    try {
        while (!exitRequested) {
            const input = await waitForInput()
            if (input === undefined) {
                break
            }

            if (input === '') {
                continue
            }

            append([`[user] ${input}`, ''])

            if (input.startsWith(':')) {
                const components = input.slice(1).split(' ')

                if (components.length > 0) {
                    const cmd = components[0]

                    if (EXIT_COMMANDS.has(cmd)) {
                        break
                    } else if (cmd === 'history') {
                        append(formatHistory(agent.getHistory()))
                    }
                }

                continue
            }

            const abortController = new AbortController()
            activeAbortController = abortController

            try {
                await agent.runTurn(input, abortController.signal)
            } finally {
                activeAbortController = undefined
            }
        }
    } finally {
        append([
            `input = ${totalInputTokens}, output = ${totalOutputTokens}, cache hit = ${asPercent(totalInputTokens === 0 ? 0 : totalCachedTokens / totalInputTokens)}`,
        ])
        agent.off('model-finish', handleModelFinish)
        terminal.off('pieces', handleTerminalPieces)
        ui.stop()
        terminal.stop()
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

    prompt += '\n<instructions>'
    if (fs.existsSync(globalAgentsMdPath)) {
        prompt += '\n' + fs.readFileSync(globalAgentsMdPath, 'utf8')
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
    prompt += '\n</instructions>'

    // Inject dynamic context after AGENTS.md contents
    prompt += '\n<current-env>'
    prompt += `\nCurrent working directory: ${process.cwd()}`
    prompt += `\nCurrent date/time: ${new Date().toISOString()}`
    prompt += `\nSystem: ${os.hostname()} / ${os.platform()} ${os.release()} (${os.arch()})`
    prompt += '\n</current-env>'

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
    await runChatCli(agent, config, cliConfig)
}

void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})

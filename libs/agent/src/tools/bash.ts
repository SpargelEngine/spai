import { Tool } from '../agent'
import { ToolSpec } from '@spai/core'
import { createWriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import z from 'zod'

const MAX_INLINE_OUTPUT_BYTES = 50 * 1024

function formatExitStatus(code: number | null, signal: NodeJS.Signals | null) {
    if (signal !== null) {
        return `Exit signal: ${signal}`
    }

    return `Exit code: ${code ?? 'unknown'}`
}

export class BashTool implements Tool {
    readonly schema = z.object({
        command: z.string().describe('The bash command to execute.'),
    })

    getSpec(): ToolSpec {
        return {
            name: 'bash',
            description:
                'Execute a bash command and return its output. Do NOT run commands that may hang indefinitely or require interactive input. If a command might hang or even have a risk of hanging, use `timeout` (e.g., `timeout 10 <command>`) to set a reasonable timeout.',
            schema: this.schema.toJSONSchema(),
        }
    }

    async execute(params: unknown): Promise<string> {
        const { command } = this.schema.parse(params)

        const outputPath = path.join(
            os.tmpdir(),
            `spai-bash-${randomUUID()}.txt`
        )

        try {
            const outputStream = createWriteStream(outputPath, { flags: 'wx' })
            const outputFinished = finished(outputStream)
            const inlineChunks: Buffer[] = []
            let outputBytes = 0

            const child = spawn('bash', ['-lc', command], {
                // TODO(tianjiao): Make cwd configurable at tool creation.
                cwd: process.cwd(),
                // TODO(tianjiao): Make this configurable as well.
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            })

            const collectOutput = (
                chunk: Buffer,
                source: NodeJS.ReadableStream
            ) => {
                if (outputBytes + chunk.length <= MAX_INLINE_OUTPUT_BYTES) {
                    inlineChunks.push(chunk)
                }

                outputBytes += chunk.length

                if (!outputStream.write(chunk)) {
                    source.pause()
                    outputStream.once('drain', () => source.resume())
                }
            }

            child.stdout.on('data', (chunk: Buffer) => {
                collectOutput(chunk, child.stdout)
            })
            child.stderr.on('data', (chunk: Buffer) => {
                collectOutput(chunk, child.stderr)
            })

            const { code, signal } = await new Promise<{
                code: number | null
                signal: NodeJS.Signals | null
            }>((resolve, reject) => {
                child.on('error', reject)
                child.on('close', (code, signal) => resolve({ code, signal }))
            })

            outputStream.end()
            await outputFinished

            const exitStatus = formatExitStatus(code, signal)

            if (outputBytes > MAX_INLINE_OUTPUT_BYTES) {
                return `${exitStatus}\nOutput (${outputBytes} bytes) exceeded ${MAX_INLINE_OUTPUT_BYTES} bytes and was written to ${outputPath}`
            }

            await fs.rm(outputPath, { force: true })

            const output = Buffer.concat(inlineChunks).toString('utf8')
            return output.length === 0 ? exitStatus : `${exitStatus}\n${output}`
        } catch (err) {
            await fs.rm(outputPath, { force: true })
            console.log(err)
            return JSON.stringify(err)
        }
    }
}

import { Tool } from '../agent'
import { ToolSpec } from '@spai/core'
import fs from 'node:fs/promises'
import z from 'zod'

function format_lines(lines: string[], start_num: number): string {
    return lines.map((line, i) => `${start_num + i}\t${line}`).join('\n')
}

export class ReadFileTool implements Tool {
    readonly schema = z.object({
        path: z
            .string()
            .describe(
                'Absolute path to file or directory, e.g. `/repo/file.py`.'
            ),
        range: z
            .union([z.null(), z.array(z.int())])
            .describe(
                'If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.'
            ),
    })
    getSpec(): ToolSpec {
        return {
            name: 'read_file',
            description: 'View the content of a file.',
            schema: this.schema.toJSONSchema(),
        }
    }
    async execute(params: unknown): Promise<string> {
        const { path, range } = this.schema.parse(params)

        try {
            const data = await fs.readFile(path, 'utf8')
            // TODO(tianjiao): How to handle '\r\n'?
            let lines = data.split('\n')
            const total = lines.length
            let start = 1

            if (range !== null) {
                if (range.length !== 2) {
                    return 'ERROR: range must be an array of two integers'
                }
                start = range[0]
                let end = range[1]
                if (start < 1) {
                    return `ERROR: range start (${start}) must be >= 1`
                }
                if (start > total) {
                    return `ERROR: range start (${start}) exceeds file total lines (${total})`
                }
                if (end !== -1 && end < start) {
                    return `ERROR: range end (${end}) must be >= start (${start})`
                }
                if (end === -1) {
                    end = total
                }
                end = Math.min(end, total)
                lines = lines.slice(start - 1, end)
            }
            return format_lines(lines, start)
        } catch (err) {
            console.log(err)
            return JSON.stringify(err)
        }
    }
}

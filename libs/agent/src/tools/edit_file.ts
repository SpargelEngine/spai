import { Tool } from '../agent'
import { ToolSpec } from '@spai/core'
import fs from 'node:fs/promises'
import pathModule from 'node:path'
import z from 'zod'

export class EditFileTool implements Tool {
    readonly schema = z.object({
        path: z
            .string()
            .describe(
                'Absolute path to the file to edit or create, e.g. `/path/to/file.py`.'
            ),
        old_str: z
            .string()
            .optional()
            .describe(
                'Optional. The old text to be replaced. It must occur in the file **exactly once**. ' +
                    'If not provided, the entire file will be overwritten with `new_str`; ' +
                    'if the file does not exist, it will be created.'
            ),
        new_str: z.string().describe('The new text to use.'),
    })
    getSpec(): ToolSpec {
        return {
            name: 'edit_file',
            description:
                'Edit the content of a file by exact searching and replacing, ' +
                'or overwrite the entire file if `old_str` is not provided.',
            schema: this.schema.toJSONSchema(),
        }
    }
    async execute(params: unknown): Promise<string> {
        const { path: filePath, old_str, new_str } = this.schema.parse(params)

        if (old_str === undefined) {
            // Overwrite mode: old_str is not provided.
            // Write the entire file with new_str (creates if not exists, overwrites if exists).
            try {
                // Ensure parent directory exists before writing
                const dir = pathModule.dirname(filePath)
                if (dir) {
                    await fs.mkdir(dir, { recursive: true })
                }
                await fs.writeFile(filePath, new_str, 'utf8')
                return 'Done.'
            } catch (err) {
                console.log(err)
                return `ERROR: ${err instanceof Error ? err.message : String(err)}`
            }
        }

        if (old_str.length === 0) {
            return 'ERROR: old_str must not be empty'
        }

        try {
            const data = await fs.readFile(filePath, 'utf8')
            const occurrenceCount = data.split(old_str).length - 1

            if (occurrenceCount !== 1) {
                return `ERROR: old_str occurs ${occurrenceCount} times in file; expected exactly once`
            }

            await fs.writeFile(filePath, data.replace(old_str, new_str), 'utf8')

            return 'Done.'
        } catch (err) {
            console.log(err)
            return `ERROR: ${err instanceof Error ? err.message : String(err)}`
        }
    }
}

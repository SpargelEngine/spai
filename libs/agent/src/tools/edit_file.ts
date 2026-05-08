import { Tool } from '../agent'
import { ToolSpec } from '@spai/core'
import fs from 'node:fs/promises'
import z from 'zod'

export class EditFileTool implements Tool {
    readonly schema = z.object({
        path: z
            .string()
            .describe(
                'Absolute path to the file to edit, e.g. `/repo/file.py`.'
            ),
        old_str: z
            .string()
            .describe(
                'The old text to be replaced. It must occur in the file **exactly once**.'
            ),
        new_str: z.string().describe('The new text to use.'),
    })
    getSpec(): ToolSpec {
        return {
            name: 'edit_file',
            description:
                'Edit the content of a file by exact searching and replacing.',
            schema: this.schema.toJSONSchema(),
        }
    }
    async execute(params: unknown): Promise<string> {
        const { path, old_str, new_str } = this.schema.parse(params)

        try {
            if (old_str.length === 0) {
                return 'ERROR: old_str must not be empty'
            }

            const data = await fs.readFile(path, 'utf8')
            const occurrenceCount = data.split(old_str).length - 1

            if (occurrenceCount !== 1) {
                return `ERROR: old_str occurs ${occurrenceCount} times in file; expected exactly once`
            }

            await fs.writeFile(path, data.replace(old_str, new_str), 'utf8')

            return 'Done.'
        } catch (err) {
            console.log(err)
            return JSON.stringify(err)
        }
    }
}

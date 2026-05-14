import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { UI } from '../src/ui'

class FakeTerminal extends EventEmitter {
    output = ''

    constructor(width = 10) {
        super()
        this.width = width
    }

    write(data) {
        this.output += data
    }

    getWidth() {
        return this.width
    }
}

describe('UI', () => {
    test('appends output without clearing the screen', () => {
        const terminal = new FakeTerminal()
        const ui = new UI(terminal)

        ui.start()
        terminal.output = ''
        ui.append(['one', 'two'])

        expect(terminal.output).toContain('one\r\ntwo\r\n')
        expect(terminal.output).not.toContain('\x1b[2J')
        expect(terminal.output).not.toContain('\x1b[J')
        expect(terminal.output).not.toContain('\x1b[0J')
    })

    test('keeps current input when output is appended', () => {
        const terminal = new FakeTerminal()
        const ui = new UI(terminal)

        ui.start()
        terminal.emit('pieces', ['h', 'i'])
        terminal.output = ''
        ui.append(['system'])

        expect(ui.getInput()).toBe('hi')
        expect(terminal.output).toContain('system\r\n')
        expect(terminal.output).toContain('──────────\r\nhi')
    })

    test('submits and clears input on enter', () => {
        const terminal = new FakeTerminal()
        const submissions = []
        const ui = new UI(terminal, {
            onSubmit: (text) => submissions.push(text),
        })

        ui.start()
        terminal.emit('pieces', ['o', 'k', '\r'])

        expect(submissions).toEqual(['ok'])
        expect(ui.getInput()).toBe('')
    })
})

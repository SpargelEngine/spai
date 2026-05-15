import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { UI } from '../src/ui'

const ESC = '\x1b'

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

describe('UI — word navigation (Option+Arrow)', () => {
    test('option+left moves cursor to previous word start', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        // Type: "hello world test"
        const text = 'hello world test'
        terminal.emit('pieces', [...text])

        expect(ui.getInput()).toBe(text)

        // Cursor is at end; option+left to "test"
        terminal.emit('pieces', [ESC + 'b'])
        expect(ui.getInput()).toBe(text)

        // option+left again to "world"
        terminal.emit('pieces', [ESC + 'b'])
        // option+left again to "hello"
        terminal.emit('pieces', [ESC + 'b'])
        // option+left again — at start, shouldn't go negative
        terminal.emit('pieces', [ESC + 'b'])
    })

    test('option+right moves cursor to next word start', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'hello world test'
        terminal.emit('pieces', [...text])

        // Move to start
        terminal.emit('pieces', [ESC + '[H'])

        // option+right to "world"
        terminal.emit('pieces', [ESC + 'f'])
        // Insert after "hello "
        terminal.emit('pieces', ['X'])
        expect(ui.getInput()).toBe('hello Xworld test')
    })

    test('option+left CSI variant moves cursor to previous word', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'foo bar'
        terminal.emit('pieces', [...text])

        terminal.emit('pieces', [ESC + '[1;3D'])
        // Insert after "foo "
        terminal.emit('pieces', ['X'])
        expect(ui.getInput()).toBe('foo Xbar')
    })

    test('option+right CSI variant moves cursor to next word', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'abc def'
        terminal.emit('pieces', [...text])
        terminal.emit('pieces', [ESC + '[H']) // home

        terminal.emit('pieces', [ESC + '[1;3C'])
        terminal.emit('pieces', ['X'])
        expect(ui.getInput()).toBe('abc Xdef')
    })
})

describe('UI — word deletion', () => {
    test('option+delete deletes previous word', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'hello world test'
        terminal.emit('pieces', [...text])

        // Cursor at end; delete "test"
        terminal.emit('pieces', [ESC + '\x7f'])
        expect(ui.getInput()).toBe('hello world ')

        // Delete "world "
        terminal.emit('pieces', [ESC + '\x7f'])
        expect(ui.getInput()).toBe('hello ')

        // Delete "hello "
        terminal.emit('pieces', [ESC + '\x7f'])
        expect(ui.getInput()).toBe('')

        // At start — no-op
        terminal.emit('pieces', [ESC + '\x7f'])
        expect(ui.getInput()).toBe('')
    })

    test('option+delete in middle of word deletes partial word', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'hello world test'
        terminal.emit('pieces', [...text])

        // Move cursor left 2 chars (inside "test" → "tet")
        terminal.emit('pieces', [ESC + '[D', ESC + '[D'])

        terminal.emit('pieces', ['s', 'u'])

        // Now: "hello world tesut" and cursor is after "su" inside the word
        // Actually: we typed "hello world test", then left 2, then "s", "u"
        // That gives: "hello world tesust" → wait no
        // Cursor was at end: "hello world test|"
        // Left 2: "hello world te|st"
        // Type "s": "hello world tes|st"
        // Type "u": "hello world tesu|st"
        // So input is "hello world tesust"
        expect(ui.getInput()).toBe('hello world tesust')

        // option+delete backward should delete "tesu"
        terminal.emit('pieces', [ESC + '\x7f'])
        expect(ui.getInput()).toBe('hello world st')
    })

    test('delete word forward (ESC d)', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'hello world test'
        terminal.emit('pieces', [...text])
        terminal.emit('pieces', [ESC + '[H']) // home

        // Delete "hello"
        terminal.emit('pieces', [ESC + 'd'])
        expect(ui.getInput()).toBe(' world test')

        // Delete " world"
        terminal.emit('pieces', [ESC + 'd'])
        expect(ui.getInput()).toBe(' test')

        // Delete " test"
        terminal.emit('pieces', [ESC + 'd'])
        expect(ui.getInput()).toBe('')
    })

    test('delete word forward CSI variant (ESC [3;3~)', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'abc def ghi'
        terminal.emit('pieces', [...text])
        terminal.emit('pieces', [ESC + '[H'])

        terminal.emit('pieces', [ESC + '[3;3~'])
        expect(ui.getInput()).toBe(' def ghi')
    })
})

describe('UI — ctrl+u (delete to line start)', () => {
    test('ctrl+u deletes from cursor to beginning of line', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'hello world'
        terminal.emit('pieces', [...text])

        // Move left 5 chars: "hello |world"
        terminal.emit('pieces', [
            ESC + '[D',
            ESC + '[D',
            ESC + '[D',
            ESC + '[D',
            ESC + '[D',
        ])

        terminal.emit('pieces', ['\x15'])
        expect(ui.getInput()).toBe('world')
    })

    test('ctrl+u at start of line is no-op', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'hello'
        terminal.emit('pieces', [...text])
        terminal.emit('pieces', [ESC + '[H'])

        terminal.emit('pieces', ['\x15'])
        expect(ui.getInput()).toBe('hello')
    })
})

describe('UI — word navigation edge cases', () => {
    test('word nav with underscores treats them as word chars', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'foo_bar baz'
        terminal.emit('pieces', [...text])

        // option+left once should go to "baz" start
        terminal.emit('pieces', [ESC + 'b'])
        // Insert X after space: "foo_bar Xbaz"
        terminal.emit('pieces', ['X'])
        expect(ui.getInput()).toBe('foo_bar Xbaz')
    })

    test('word nav with punctuation treats it as non-word', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        const text = 'hello, world!'
        terminal.emit('pieces', [...text])

        // option+left: cursor goes to "world" start (pos 7)
        terminal.emit('pieces', [ESC + 'b'])
        // Insert X between ", " and "world": "hello, Xworld!"
        terminal.emit('pieces', ['X'])
        expect(ui.getInput()).toBe('hello, Xworld!')
    })

    test('word nav at start goes nowhere', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        terminal.emit('pieces', ['h', 'i'])
        terminal.emit('pieces', [ESC + '[H'])

        terminal.emit('pieces', [ESC + 'b'])
        terminal.emit('pieces', ['X'])
        expect(ui.getInput()).toBe('Xhi')
    })

    test('word nav at end goes nowhere', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        terminal.emit('pieces', ['h', 'i'])

        // Cursor already at end
        terminal.emit('pieces', [ESC + 'f'])
        terminal.emit('pieces', ['!'])
        expect(ui.getInput()).toBe('hi!')
    })
})

describe('UI — double-width (CJK) character handling', () => {
    test('can type chinese characters', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        // '你好' = two Chinese characters
        terminal.emit('pieces', ['你', '好'])

        expect(ui.getInput()).toBe('你好')
    })

    test('cursor movement over mixed ASCII and CJK preserves text', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        // Type "ab你好cd" and move around
        const text = ['a', 'b', '你', '好', 'c', 'd']
        terminal.emit('pieces', text)

        expect(ui.getInput()).toBe('ab你好cd')

        // Move left 1, insert X: "ab你好cXd"
        terminal.emit('pieces', [ESC + '[D'])
        terminal.emit('pieces', ['X'])
        expect(ui.getInput()).toBe('ab你好cXd')

        // Move left 4 more (past "好你"): cursor at "ab|你好cXd"
        terminal.emit('pieces', [
            ESC + '[D',
            ESC + '[D',
            ESC + '[D',
            ESC + '[D',
        ])
        terminal.emit('pieces', ['Y'])
        expect(ui.getInput()).toBe('abY你好cXd')
    })

    test('word navigation treats CJK as non-word separators', () => {
        const terminal = new FakeTerminal(40)
        const ui = new UI(terminal)

        ui.start()
        // "hello 你好 world"
        const text = 'hello 你好 world'
        terminal.emit('pieces', [...text])

        expect(ui.getInput()).toBe('hello 你好 world')

        // Option+left from end: cursor should go to start of "world"
        terminal.emit('pieces', [ESC + 'b'])
        terminal.emit('pieces', ['X'])
        expect(ui.getInput()).toBe('hello 你好 Xworld')
    })
})

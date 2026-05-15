import { describe, test, expect } from 'vitest'
import { extractPieces } from '../src/terminal'

// ESC character
const ESC = '\x1b'

// ─── Single characters (non-ESC) ────────────────────────────────────────────

describe('single characters', () => {
    test('empty string', () => {
        expect(extractPieces('')).toEqual({ pieces: [], remaining: '' })
    })

    test('single char', () => {
        expect(extractPieces('x')).toEqual({ pieces: ['x'], remaining: '' })
    })

    test('plain ASCII text', () => {
        expect(extractPieces('hello')).toEqual({
            pieces: ['h', 'e', 'l', 'l', 'o'],
            remaining: '',
        })
    })
})

// ─── Simple two-char escape sequences (ESC + char) ─────────────────────────

describe('two-char escape sequences', () => {
    test('ESC c (RIS - reset)', () => {
        expect(extractPieces(ESC + 'c')).toEqual({
            pieces: [ESC + 'c'],
            remaining: '',
        })
    })

    test('ESC 7 (save cursor)', () => {
        expect(extractPieces(ESC + '7')).toEqual({
            pieces: [ESC + '7'],
            remaining: '',
        })
    })

    test('ESC 8 (restore cursor)', () => {
        expect(extractPieces(ESC + '8')).toEqual({
            pieces: [ESC + '8'],
            remaining: '',
        })
    })

    test('ESC D (index)', () => {
        expect(extractPieces(ESC + 'D')).toEqual({
            pieces: [ESC + 'D'],
            remaining: '',
        })
    })

    test('ESC M (reverse index)', () => {
        expect(extractPieces(ESC + 'M')).toEqual({
            pieces: [ESC + 'M'],
            remaining: '',
        })
    })

    test('ESC E (next line)', () => {
        expect(extractPieces(ESC + 'E')).toEqual({
            pieces: [ESC + 'E'],
            remaining: '',
        })
    })

    test('ESC ( B (select character set, 3 chars)', () => {
        expect(extractPieces(ESC + '(B')).toEqual({
            pieces: [ESC + '(B'],
            remaining: '',
        })
    })

    test('ESC ) A (select character set, 3 chars)', () => {
        expect(extractPieces(ESC + ')A')).toEqual({
            pieces: [ESC + ')A'],
            remaining: '',
        })
    })

    test('ESC % G (UTF-8, 3 chars)', () => {
        expect(extractPieces(ESC + '%G')).toEqual({
            pieces: [ESC + '%G'],
            remaining: '',
        })
    })
})

// ─── CSI sequences (ESC [ ... ) ────────────────────────────────────────────

describe('CSI sequences', () => {
    test('arrow up (ESC [ A)', () => {
        expect(extractPieces(ESC + '[A')).toEqual({
            pieces: [ESC + '[A'],
            remaining: '',
        })
    })

    test('arrow down (ESC [ B)', () => {
        expect(extractPieces(ESC + '[B')).toEqual({
            pieces: [ESC + '[B'],
            remaining: '',
        })
    })

    test('arrow right (ESC [ C)', () => {
        expect(extractPieces(ESC + '[C')).toEqual({
            pieces: [ESC + '[C'],
            remaining: '',
        })
    })

    test('arrow left (ESC [ D)', () => {
        expect(extractPieces(ESC + '[D')).toEqual({
            pieces: [ESC + '[D'],
            remaining: '',
        })
    })

    test('home (ESC [ H)', () => {
        expect(extractPieces(ESC + '[H')).toEqual({
            pieces: [ESC + '[H'],
            remaining: '',
        })
    })

    test('end (ESC [ F)', () => {
        expect(extractPieces(ESC + '[F')).toEqual({
            pieces: [ESC + '[F'],
            remaining: '',
        })
    })

    test('insert (ESC [ 2 ~)', () => {
        expect(extractPieces(ESC + '[2~')).toEqual({
            pieces: [ESC + '[2~'],
            remaining: '',
        })
    })

    test('delete (ESC [ 3 ~)', () => {
        expect(extractPieces(ESC + '[3~')).toEqual({
            pieces: [ESC + '[3~'],
            remaining: '',
        })
    })

    test('page up (ESC [ 5 ~)', () => {
        expect(extractPieces(ESC + '[5~')).toEqual({
            pieces: [ESC + '[5~'],
            remaining: '',
        })
    })

    test('page down (ESC [ 6 ~)', () => {
        expect(extractPieces(ESC + '[6~')).toEqual({
            pieces: [ESC + '[6~'],
            remaining: '',
        })
    })

    test('F1 (ESC [ 1 1 ~)', () => {
        expect(extractPieces(ESC + '[11~')).toEqual({
            pieces: [ESC + '[11~'],
            remaining: '',
        })
    })

    test('F2 (ESC [ 1 2 ~)', () => {
        expect(extractPieces(ESC + '[12~')).toEqual({
            pieces: [ESC + '[12~'],
            remaining: '',
        })
    })

    test('cursor position report (ESC [ 2 0 ; 1 R)', () => {
        expect(extractPieces(ESC + '[20;1R')).toEqual({
            pieces: [ESC + '[20;1R'],
            remaining: '',
        })
    })

    test('SGR red foreground (ESC [ 3 1 m)', () => {
        expect(extractPieces(ESC + '[31m')).toEqual({
            pieces: [ESC + '[31m'],
            remaining: '',
        })
    })

    test('SGR bold + red (ESC [ 1 ; 3 1 m)', () => {
        expect(extractPieces(ESC + '[1;31m')).toEqual({
            pieces: [ESC + '[1;31m'],
            remaining: '',
        })
    })
})

// ─── OSC sequences (ESC ] ... ) ────────────────────────────────────────────

describe('OSC sequences', () => {
    test('set window title terminated by BEL (ESC ] 0 ; title BEL)', () => {
        const seq = ESC + ']0;my title' + '\x07'
        expect(extractPieces(seq)).toEqual({
            pieces: [seq],
            remaining: '',
        })
    })

    test('set window title terminated by ST (ESC ] 0 ; title ESC \\)', () => {
        const seq = ESC + ']0;my title' + ESC + '\\'
        expect(extractPieces(seq)).toEqual({
            pieces: [seq],
            remaining: '',
        })
    })

    test('OSC with no content, just BEL', () => {
        const seq = ESC + ']\x07'
        expect(extractPieces(seq)).toEqual({
            pieces: [seq],
            remaining: '',
        })
    })

    test('OSC with no content, just ST', () => {
        const seq = ESC + ']' + ESC + '\\'
        expect(extractPieces(seq)).toEqual({
            pieces: [seq],
            remaining: '',
        })
    })
})

// ─── Mixed content ─────────────────────────────────────────────────────────

describe('mixed content', () => {
    test('plain text followed by an escape sequence', () => {
        expect(extractPieces('ab' + ESC + '[A')).toEqual({
            pieces: ['a', 'b', ESC + '[A'],
            remaining: '',
        })
    })

    test('escape sequence followed by plain text', () => {
        expect(extractPieces(ESC + '[A' + 'xy')).toEqual({
            pieces: [ESC + '[A', 'x', 'y'],
            remaining: '',
        })
    })

    test('multiple escape sequences', () => {
        expect(extractPieces(ESC + '[A' + ESC + '[B' + ESC + '[C')).toEqual({
            pieces: [ESC + '[A', ESC + '[B', ESC + '[C'],
            remaining: '',
        })
    })

    test('text, ESC, text, ESC, text', () => {
        expect(
            extractPieces('a' + ESC + '[A' + 'b' + ESC + '[B' + 'c')
        ).toEqual({
            pieces: ['a', ESC + '[A', 'b', ESC + '[B', 'c'],
            remaining: '',
        })
    })

    test('mixed CSI, OSC, and two-char sequences', () => {
        const input =
            'x' +
            ESC +
            '[31m' + // CSI
            'y' +
            ESC +
            'c' + // two-char
            'z' +
            ESC +
            ']0;hello' +
            ESC +
            '\\' + // OSC
            'w'
        expect(extractPieces(input)).toEqual({
            pieces: [
                'x',
                ESC + '[31m',
                'y',
                ESC + 'c',
                'z',
                ESC + ']0;hello' + ESC + '\\',
                'w',
            ],
            remaining: '',
        })
    })
})

// ─── Incomplete sequences (remaining) ──────────────────────────────────────

describe('incomplete sequences (remaining)', () => {
    test('bare ESC at end of buffer', () => {
        expect(extractPieces('ab' + ESC)).toEqual({
            pieces: ['a', 'b'],
            remaining: ESC,
        })
    })

    test('incomplete CSI (missing final byte)', () => {
        expect(extractPieces(ESC + '[1;2')).toEqual({
            pieces: [],
            remaining: ESC + '[1;2',
        })
    })

    test('text then incomplete CSI', () => {
        expect(extractPieces('x' + ESC + '[1;2')).toEqual({
            pieces: ['x'],
            remaining: ESC + '[1;2',
        })
    })

    test('complete CSI then incomplete CSI', () => {
        expect(extractPieces(ESC + '[A' + ESC + '[1;2')).toEqual({
            pieces: [ESC + '[A'],
            remaining: ESC + '[1;2',
        })
    })

    test('incomplete OSC (missing terminator)', () => {
        expect(extractPieces(ESC + ']0;hello')).toEqual({
            pieces: [],
            remaining: ESC + ']0;hello',
        })
    })

    test('text then incomplete OSC', () => {
        expect(extractPieces('abc' + ESC + ']0;hello')).toEqual({
            pieces: ['a', 'b', 'c'],
            remaining: ESC + ']0;hello',
        })
    })

    test('incomplete two-char (ESC only at end)', () => {
        expect(extractPieces(ESC)).toEqual({
            pieces: [],
            remaining: ESC,
        })
    })

    test('incomplete three-char (ESC ( only, missing final)', () => {
        expect(extractPieces(ESC + '(')).toEqual({
            pieces: [],
            remaining: ESC + '(',
        })
    })

    test('incomplete CSI with intermediate bytes only', () => {
        expect(extractPieces(ESC + '[\x20')).toEqual({
            pieces: [],
            remaining: ESC + '[\x20',
        })
    })
})

// ─── Editor key sequences ─────────────────────────────────────────────────

describe('editor key sequences', () => {
    test('ESC b (option-left / word-back)', () => {
        expect(extractPieces(ESC + 'b')).toEqual({
            pieces: [ESC + 'b'],
            remaining: '',
        })
    })

    test('ESC f (option-right / word-forward)', () => {
        expect(extractPieces(ESC + 'f')).toEqual({
            pieces: [ESC + 'f'],
            remaining: '',
        })
    })

    test('ESC DEL (option-delete / delete-word-backward)', () => {
        expect(extractPieces(ESC + '\x7f')).toEqual({
            pieces: [ESC + '\x7f'],
            remaining: '',
        })
    })

    test('ESC d (delete-word-forward)', () => {
        expect(extractPieces(ESC + 'd')).toEqual({
            pieces: [ESC + 'd'],
            remaining: '',
        })
    })

    test('CSI 1;3D (option-left with modifier)', () => {
        expect(extractPieces(ESC + '[1;3D')).toEqual({
            pieces: [ESC + '[1;3D'],
            remaining: '',
        })
    })

    test('CSI 1;3C (option-right with modifier)', () => {
        expect(extractPieces(ESC + '[1;3C')).toEqual({
            pieces: [ESC + '[1;3C'],
            remaining: '',
        })
    })

    test('ESC DEL followed by printable chars', () => {
        expect(extractPieces(ESC + '\x7f' + 'xy')).toEqual({
            pieces: [ESC + '\x7f', 'x', 'y'],
            remaining: '',
        })
    })

    test('text then ESC DEL then text', () => {
        expect(extractPieces('ab' + ESC + '\x7f' + 'cd')).toEqual({
            pieces: ['a', 'b', ESC + '\x7f', 'c', 'd'],
            remaining: '',
        })
    })
})

// ─── Edge cases ────────────────────────────────────────────────────────────

describe('edge cases', () => {
    test('only ESC in buffer', () => {
        expect(extractPieces(ESC)).toEqual({ pieces: [], remaining: ESC })
    })

    test('ESC followed by valid final byte chars are treated as sequences', () => {
        // 'a', 'b', 'c' are all in the final-byte range (0x30–0x7E),
        // so ESC a is a complete 2-char sequence, and b, c are single chars.
        expect(extractPieces(ESC + 'abc')).toEqual({
            pieces: [ESC + 'a', 'b', 'c'],
            remaining: '',
        })
    })

    test('multiple characters before ESC', () => {
        expect(extractPieces('hello' + ESC + '[3~')).toEqual({
            pieces: ['h', 'e', 'l', 'l', 'o', ESC + '[3~'],
            remaining: '',
        })
    })

    test('non-ASCII character (single UTF-16 code unit)', () => {
        // In JavaScript, 'ñ' is a single UTF-16 code unit, so it is
        // treated as a single character piece.
        const result = extractPieces('ñ')
        expect(result).toEqual({ pieces: ['ñ'], remaining: '' })
    })

    test('entirely valid complex input with no remaining', () => {
        const input =
            ESC +
            '[1;2H' + // cursor position
            ESC +
            '[K' + // erase in line
            'A' +
            ESC +
            '[31;1m' + // SGR
            'B'
        expect(extractPieces(input)).toEqual({
            pieces: [ESC + '[1;2H', ESC + '[K', 'A', ESC + '[31;1m', 'B'],
            remaining: '',
        })
    })
})

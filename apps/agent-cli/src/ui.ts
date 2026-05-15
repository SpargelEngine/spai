import { Terminal } from './terminal'

export interface UIOptions {
    onSubmit?: (text: string) => void
}

const SEPARATOR_CHAR = '\u2500' // ─

export class UI {
    private inputText: string = ''
    private inputCursor: number = 0
    private onSubmit?: (text: string) => void
    private inputAreaRendered = false
    private renderedInputRows = 1
    private renderedCursorInputRow = 0

    constructor(
        private terminal: Terminal,
        options?: UIOptions
    ) {
        this.onSubmit = options?.onSubmit
    }

    start(): void {
        this.terminal.on('pieces', this.handlePieces)
        this.render()
    }

    stop(): void {
        this.terminal.off('pieces', this.handlePieces)
    }

    append(lines: string[]): void {
        if (lines.length === 0) return

        this.eraseRenderedInputArea()

        for (const line of lines) {
            this.write(line)
            this.write('\r\n')
        }

        this.renderInputArea()
    }

    getInput(): string {
        return this.inputText
    }

    clearInput(): void {
        this.inputText = ''
        this.inputCursor = 0
        this.redrawInput()
    }

    private handlePieces = (pieces: string[]): void => {
        for (const piece of pieces) {
            this.handlePiece(piece)
        }
    }

    private handlePiece(piece: string): void {
        if (piece === '\r' || piece === '\n') {
            // Submit
            const text = this.inputText
            this.inputText = ''
            this.inputCursor = 0
            this.redrawInput()
            this.onSubmit?.(text)
            return
        }

        if (piece === '\x7f') {
            // Backspace
            if (this.inputCursor > 0) {
                this.inputText =
                    this.inputText.slice(0, this.inputCursor - 1) +
                    this.inputText.slice(this.inputCursor)
                this.inputCursor--
                this.redrawInput()
            }
            return
        }

        if (piece === '\x15') {
            // Ctrl+U — delete from cursor to beginning of line
            if (this.inputCursor > 0) {
                this.inputText = this.inputText.slice(this.inputCursor)
                this.inputCursor = 0
                this.redrawInput()
            }
            return
        }

        if (piece.length === 1 && piece >= ' ') {
            // Printable character
            this.inputText =
                this.inputText.slice(0, this.inputCursor) +
                piece +
                this.inputText.slice(this.inputCursor)
            this.inputCursor++
            this.redrawInput()
            return
        }

        // Escape sequences (navigation)
        switch (piece) {
            case '\x1b[D':
            case '\x1bOD':
                // Left arrow
                if (this.inputCursor > 0) {
                    this.inputCursor--
                    this.redrawInput()
                }
                return
            case '\x1b[C':
            case '\x1bOC':
                // Right arrow
                if (this.inputCursor < this.inputText.length) {
                    this.inputCursor++
                    this.redrawInput()
                }
                return
            case '\x1b[H':
            case '\x1bOH':
            case '\x1b[1~':
                // Home
                this.inputCursor = 0
                this.redrawInput()
                return
            case '\x1b[F':
            case '\x1bOF':
            case '\x1b[4~':
                // End
                this.inputCursor = this.inputText.length
                this.redrawInput()
                return
            case '\x1b[3~':
                // Delete
                if (this.inputCursor < this.inputText.length) {
                    this.inputText =
                        this.inputText.slice(0, this.inputCursor) +
                        this.inputText.slice(this.inputCursor + 1)
                    this.redrawInput()
                }
                return
            case '\x1bb':
            case '\x1b[1;3D':
                // Option+Left — move cursor to previous word boundary
                this.inputCursor = this.findPrevWordBoundary(
                    this.inputText,
                    this.inputCursor
                )
                this.redrawInput()
                return
            case '\x1bf':
            case '\x1b[1;3C':
                // Option+Right — move cursor to next word boundary
                this.inputCursor = this.findNextWordBoundary(
                    this.inputText,
                    this.inputCursor
                )
                this.redrawInput()
                return
            case '\x1b\x7f':
                // Option+Delete — delete word backward from cursor
                if (this.inputCursor > 0) {
                    const prev = this.findPrevWordBoundary(
                        this.inputText,
                        this.inputCursor
                    )
                    this.inputText =
                        this.inputText.slice(0, prev) +
                        this.inputText.slice(this.inputCursor)
                    this.inputCursor = prev
                    this.redrawInput()
                }
                return
            case '\x1bd':
            case '\x1b[3;3~':
                // Option+Forward-Delete — delete word forward from cursor
                if (this.inputCursor < this.inputText.length) {
                    const next = this.findWordEnd(
                        this.inputText,
                        this.inputCursor
                    )
                    this.inputText =
                        this.inputText.slice(0, this.inputCursor) +
                        this.inputText.slice(next)
                    this.redrawInput()
                }
                return
            default:
                // Unknown sequence — ignore
                return
        }
    }

    /**
     * Find the start of the word before `cursor`.
     * Skips whitespace going backward, then word characters,
     * returning the position of the word start.
     */
    private findPrevWordBoundary(text: string, cursor: number): number {
        let pos = cursor

        // Skip non-word characters backward (whitespace, punctuation, etc.)
        while (pos > 0 && !this.isWordChar(text[pos - 1])) {
            pos--
        }
        // Skip word characters backward
        while (pos > 0 && this.isWordChar(text[pos - 1])) {
            pos--
        }

        return pos
    }

    /**
     * Find the start of the word after `cursor`.
     * Skips word characters forward, then non-word characters,
     * returning the position of the next word start.
     */
    private findNextWordBoundary(text: string, cursor: number): number {
        let pos = cursor

        // Skip word characters forward
        while (pos < text.length && this.isWordChar(text[pos])) {
            pos++
        }
        // Skip non-word characters forward (whitespace, punctuation, etc.)
        while (pos < text.length && !this.isWordChar(text[pos])) {
            pos++
        }

        return pos
    }

    /**
     * Find the end of the word at or after `cursor`.
     * Unlike findNextWordBoundary, this stops at the word end
     * without consuming trailing non-word characters (whitespace/punctuation).
     */
    private findWordEnd(text: string, cursor: number): number {
        let pos = cursor

        // If cursor is not on a word character, skip non-word chars first
        if (pos < text.length && !this.isWordChar(text[pos])) {
            while (pos < text.length && !this.isWordChar(text[pos])) {
                pos++
            }
        }

        // Skip word characters
        while (pos < text.length && this.isWordChar(text[pos])) {
            pos++
        }

        return pos
    }

    /**
     * Returns true if `ch` is a word character (alphanumeric or underscore).
     */
    private isWordChar(ch: string): boolean {
        const code = ch.charCodeAt(0)
        return (
            (code >= 0x30 && code <= 0x39) || // 0-9
            (code >= 0x41 && code <= 0x5a) || // A-Z
            (code >= 0x61 && code <= 0x7a) || // a-z
            code === 0x5f // _
        )
    }

    private redrawInput(): void {
        this.eraseRenderedInputArea()
        this.renderInputArea()
    }

    private positionInputCursor(
        cursor: { row: number; col: number },
        rowCount: number
    ): void {
        const rowsUp = rowCount - 1 - cursor.row
        if (rowsUp > 0) {
            this.write(`\x1b[${rowsUp}A`)
        }
        this.write(`\x1b[${cursor.col + 1}G`)
    }

    private render(): void {
        this.renderInputArea()
    }

    private write(data: string): void {
        this.terminal.write(data)
    }

    private eraseRenderedInputArea(): void {
        if (!this.inputAreaRendered) return

        this.moveFromInputCursorToAreaTop()

        const totalRows = this.renderedInputRows + 1
        for (let row = 0; row < totalRows; row++) {
            this.write('\x1b[2K')
            if (row < totalRows - 1) {
                this.write('\x1b[B')
                this.write('\r')
            }
        }

        if (totalRows > 1) {
            this.write(`\x1b[${totalRows - 1}A`)
        }
        this.write('\r')
        this.inputAreaRendered = false
    }

    private moveFromInputCursorToAreaTop(): void {
        const rowsUp = this.renderedCursorInputRow + 1
        if (rowsUp > 0) {
            this.write(`\x1b[${rowsUp}A`)
        }
        this.write('\r')
    }

    private renderInputArea(): void {
        const width = this.getWidth()
        const rows = this.getInputRows(width)
        const cursor = this.getInputCursorPosition(width)

        this.write(this.getSeparator(width))
        this.write('\r\n')

        for (let i = 0; i < rows.length; i++) {
            this.write(rows[i])
            if (i < rows.length - 1) {
                this.write('\r\n')
            }
        }

        this.renderedInputRows = rows.length
        this.renderedCursorInputRow = cursor.row
        this.inputAreaRendered = true
        this.positionInputCursor(cursor, rows.length)
    }

    private getInputRows(width: number): string[] {
        if (this.inputText.length === 0) return ['']

        const rows: string[] = ['']
        let rowWidth = 0

        for (const ch of this.inputText) {
            const chWidth = this.charDisplayWidth(ch)
            if (rowWidth + chWidth > width && rowWidth > 0) {
                rows.push('')
                rowWidth = 0
            }
            rows[rows.length - 1] += ch
            rowWidth += chWidth
        }

        // If the last row is exactly full, add an empty row for the cursor
        if (rowWidth === width && this.inputText.length > 0) {
            rows.push('')
        }

        return rows
    }

    private getInputCursorPosition(width: number): {
        row: number
        col: number
    } {
        let row = 0
        let col = 0
        let charCount = 0

        for (const ch of this.inputText) {
            if (charCount >= this.inputCursor) break
            charCount++

            const chWidth = this.charDisplayWidth(ch)
            if (col + chWidth > width && col > 0) {
                row++
                col = 0
            }
            col += chWidth
        }

        return { row, col }
    }

    /**
     * Returns the terminal display width of a character.
     * CJK, fullwidth, and certain wide symbols occupy 2 columns;
     * most other characters occupy 1 column; control chars occupy 0.
     */
    private charDisplayWidth(ch: string): number {
        const code = ch.codePointAt(0)!
        // Zero-width and control characters
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
            return 0
        }
        // Wide East Asian characters (CJK, Hangul, fullwidth, etc.)
        if (
            (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
            code === 0x2329 ||
            code === 0x232a || // Angle brackets
            (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals, Kangxi
            (code >= 0x3040 && code <= 0x33bf) || // Hiragana, Katakana, Bopomofo, etc.
            (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
            (code >= 0x4e00 && code <= 0xa4cf) || // CJK Unified, Yi
            (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
            (code >= 0xf900 && code <= 0xfaff) || // CJK Compat
            (code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
            (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compat Forms
            (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
            (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
            (code >= 0x1f300 && code <= 0x1f64f) || // Misc Symbols / Emoticons
            (code >= 0x1f680 && code <= 0x1f6ff) || // Transport / Symbols
            (code >= 0x20000 && code <= 0x3fffd) // CJK Ext B+
        ) {
            return 2
        }
        return 1
    }

    private getWidth(): number {
        const width = this.terminal.getWidth()
        return width > 0 ? width : 80
    }

    private getSeparator(width = this.getWidth()): string {
        return SEPARATOR_CHAR.repeat(width)
    }
}

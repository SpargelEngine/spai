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

        if (piece.length === 1 && piece >= ' ' && piece < '\x7f') {
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
            default:
                // Unknown sequence — ignore
                return
        }
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

        const rows: string[] = []
        for (let start = 0; start < this.inputText.length; start += width) {
            rows.push(this.inputText.slice(start, start + width))
        }
        if (this.inputText.length % width === 0) {
            rows.push('')
        }
        return rows
    }

    private getInputCursorPosition(width: number): {
        row: number
        col: number
    } {
        return {
            row: Math.floor(this.inputCursor / width),
            col: this.inputCursor % width,
        }
    }

    private getWidth(): number {
        const width = this.terminal.getWidth()
        return width > 0 ? width : 80
    }

    private getSeparator(width = this.getWidth()): string {
        return SEPARATOR_CHAR.repeat(width)
    }
}

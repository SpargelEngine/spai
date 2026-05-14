import { EventEmitter } from 'node:events'

/** Event map for Terminal. */
export interface TerminalEventMap {
    pieces: [pieces: string[]]
}

/**
 * Parse a string containing escape sequences into discrete pieces.
 *
 * Pieces are either:
 *   (a) a single non-ESC character, or
 *   (b) a complete escape sequence.
 *
 * At most one incomplete escape sequence may appear at the end of the input;
 * that tail is returned as `remaining`.
 *
 * Supported escape sequence types:
 *   - CSI: ESC [ parameter-bytes? intermediate-bytes? final-byte
 *   - OSC: ESC ] … terminated by BEL (0x07) or ST (ESC \)
 *   - Other: ESC intermediate-bytes* final-byte  (ECMA-48)
 */
export function extractPieces(buffer: string): {
    pieces: string[]
    remaining: string
} {
    const pieces: string[] = []
    let i = 0

    while (i < buffer.length) {
        if (buffer[i] !== '\x1b') {
            // Single character (non-ESC)
            pieces.push(buffer[i])
            i++
            continue
        }

        // We have an ESC; we need at least one more char to form a sequence.
        if (i + 1 >= buffer.length) {
            return { pieces, remaining: buffer.slice(i) }
        }

        const next = buffer[i + 1]

        if (next === '[') {
            // CSI sequence: ESC [ param* interm* final
            let j = i + 2

            // Parameter bytes (0x30–0x3F): digits, semicolons, etc.
            while (
                j < buffer.length &&
                buffer[j] >= '\x30' &&
                buffer[j] <= '\x3F'
            ) {
                j++
            }
            // Intermediate bytes (0x20–0x2F)
            while (
                j < buffer.length &&
                buffer[j] >= '\x20' &&
                buffer[j] <= '\x2F'
            ) {
                j++
            }
            // Final byte (0x40–0x7E)
            if (
                j < buffer.length &&
                buffer[j] >= '\x40' &&
                buffer[j] <= '\x7E'
            ) {
                pieces.push(buffer.slice(i, j + 1))
                i = j + 1
            } else {
                return { pieces, remaining: buffer.slice(i) }
            }
        } else if (next === ']') {
            // OSC sequence: ESC ] … terminated by BEL (0x07) or ST (ESC \)
            let j = i + 2

            while (j < buffer.length) {
                if (buffer[j] === '\x07') {
                    pieces.push(buffer.slice(i, j + 1))
                    i = j + 1
                    break
                }
                if (
                    buffer[j] === '\x1b' &&
                    j + 1 < buffer.length &&
                    buffer[j + 1] === '\\'
                ) {
                    pieces.push(buffer.slice(i, j + 2))
                    i = j + 2
                    break
                }
                j++
            }
            if (j >= buffer.length) {
                return { pieces, remaining: buffer.slice(i) }
            }
        } else {
            // General escape sequence (ECMA-48):
            // ESC intermediate-bytes* final-byte
            let j = i + 1

            // Intermediate bytes (0x20–0x2F) before the final byte
            while (
                j < buffer.length &&
                buffer[j] >= '\x20' &&
                buffer[j] <= '\x2F'
            ) {
                j++
            }
            // Final byte (0x30–0x7E)
            if (
                j < buffer.length &&
                buffer[j] >= '\x30' &&
                buffer[j] <= '\x7E'
            ) {
                pieces.push(buffer.slice(i, j + 1))
                i = j + 1
            } else {
                return { pieces, remaining: buffer.slice(i) }
            }
        }
    }

    return { pieces, remaining: '' }
}

export class Terminal extends EventEmitter<TerminalEventMap> {
    inputBuffer: string = ''
    private rawModeEnabled = false
    private started = false
    private handleData = (data: string | Buffer): void => {
        this.inputBuffer += data
        const { pieces, remaining } = extractPieces(this.inputBuffer)
        this.inputBuffer = remaining
        if (pieces.length > 0) {
            this.emit('pieces', pieces)
        }
    }

    start(): void {
        if (this.started) return

        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true)
            this.rawModeEnabled = true
        }
        process.stdin.resume()
        process.stdin.on('data', this.handleData)
        this.started = true
    }

    stop(): void {
        if (!this.started) return

        process.stdin.off('data', this.handleData)
        if (this.rawModeEnabled && process.stdin.isTTY) {
            process.stdin.setRawMode(false)
            this.rawModeEnabled = false
        }
        if (process.stdin.listenerCount('data') === 0) {
            process.stdin.pause()
        }
        this.inputBuffer = ''
        this.started = false
    }

    write(data: string): void {
        process.stdout.write(data)
    }

    getWidth(): number {
        return process.stdout.columns
    }
}

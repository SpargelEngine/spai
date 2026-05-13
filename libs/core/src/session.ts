import type { Message } from './types'

export class Session {
    private messages: Message[]

    constructor(messages?: Message[]) {
        this.messages = messages ? [...messages] : []
    }

    add(message: Message): void {
        this.messages.push(message)
    }

    getMessages(): readonly Message[] {
        return this.messages
    }

    getLastMessage(): Message | undefined {
        return this.messages[this.messages.length - 1]
    }

    clear(): void {
        this.messages = []
    }
}

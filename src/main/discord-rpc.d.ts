/* eslint-disable @typescript-eslint/no-explicit-any */
// discord-rpc ships no TypeScript definitions; this minimal surface covers
// exactly what the presence module uses.
declare module 'discord-rpc' {
  export interface Presence {
    details?: string
    state?: string
    startTimestamp?: number
    endTimestamp?: number
    largeImageKey?: string
    largeImageText?: string
    smallImageKey?: string
    smallImageText?: string
    instance?: boolean
  }
  export class Client {
    constructor(opts: { transport: 'ipc' })
    login(opts: { clientId: string }): Promise<void>
    setActivity(presence?: Presence): unknown
    clearActivity(): unknown
    destroy(): Promise<void>
    on(event: 'ready' | 'disconnected', cb: () => void): void
  }
  export function register(clientId: string): unknown
}

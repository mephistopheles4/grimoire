export type Level = number

declare module 'claude-code' {
  interface PluginState {
    'decisions-proto': {
      variant: string
      tab: string
      filter: string
      read: string[]
      flagged: string[]
      open: string[]
      folded: string[]
      level: number
      levelDefault: number
      queue: number
      picked: string[]
      dismissed: string[]
    }
  }
}

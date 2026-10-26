export type Flag = boolean

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
      auto: boolean
      autoDefault: boolean
      queue: number
    }
  }
}

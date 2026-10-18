/** The owner's acknowledgement: when, and which version of the list. */
export type Ack = { at: string; version: string }

declare module 'claude-code' {
  interface PluginState {
    'chef-band': { isLead: boolean; ack: Ack | null }
  }
}

declare module 'claude-code' {
  interface PluginState {
    'incantation-sherpa': {
      /** The mic band's last reading of the listener's levels file: the stamp, a
       *  state word and 24 digits, 0 to 8. Numbers only; null with no listener. */
      micFrame: { stamp: number; word: string; digits: string } | null
      /** The colour change of the state word: before, now, and the step, 0 to 4. */
      micEase: { from: string; to: string; step: number }
      /** The 24 digits of the reading before micFrame's, or ''. */
      micPrev: string
      /** Whether the listener's voice is muted, as its voice file says. */
      micVoiceMuted: boolean
    }
  }
}

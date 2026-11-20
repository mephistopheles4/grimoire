import type { Register } from 'claude-code';

import { registerMic } from './mic-band.tsx';

// The mod ships one skill, incantation-sherpa, and two hooks. One speaks a nudge when Claude Code
// is about to wait on a permission prompt, so a hands-free person knows to look at the screen; it
// never answers the prompt, and the nudge runs on its own, not awaited. The other draws the mic
// band above the prompt (mic-band.tsx): the listener's state, its wave, and the mic and voice buttons.
export const register: Register = on => {
  on('classic.PermissionRequest', ($, e, next) => {
    void $.process
      .run(['node', `${$.plugin.root}/skills/incantation-sherpa/scripts/nudge.mjs`], { timeoutMs: 120_000 })
      .catch(() => undefined);
    return next(e);
  }).catch(($, e, next) => next(e));
  registerMic(on);
};

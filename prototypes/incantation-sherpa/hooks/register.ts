import type { Register } from 'claude-code';

// The mod ships one skill, incantation-sherpa. Its one hook speaks a nudge when Claude Code is
// about to wait on a permission prompt, so a hands-free person knows to look at the screen.
// The hook never answers the prompt: it returns what the rest of the chain decides, and the
// nudge runs on its own, not awaited, so the prompt is never held up.
export const register: Register = on => {
  on('classic.PermissionRequest', ($, e, next) => {
    void $.process
      .run(['node', `${$.plugin.root}/skills/incantation-sherpa/scripts/nudge.mjs`], { timeoutMs: 120_000 })
      .catch(() => undefined);
    return next(e);
  }).catch(($, e, next) => next(e));
};

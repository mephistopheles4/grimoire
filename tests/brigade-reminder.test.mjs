// The roster reminder (issue 532), tested at its own seam: brigade/reminder.ts
// holds the rules with no engine import. The turn-level cases (a decision, a
// send, an idle subscription, a subagent) run in brigade/set-roster.test.ts,
// driven through the engine. These two are what that file does not pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { REMINDER_LINE, endTurn, sendsMessage, tally } = await import('../brigade/reminder.ts');

test('a send after the last set_roster gets the reminder, so the order counts', () => {
  const t = { owed: false };
  tally(t, 'roster');
  tally(t, 'send');
  assert.equal(endTurn(t), REMINDER_LINE);
});

test('a background start after the last set_roster gets the reminder too, and set_roster clears it', () => {
  const t = { owed: false };
  tally(t, 'start');
  assert.equal(endTurn(t), REMINDER_LINE);
  assert.match(REMINDER_LINE, /started a background session after your last set_roster/);
  tally(t, 'start');
  tally(t, 'roster');
  assert.equal(endTurn(t), undefined);
});

test('only a send that carries a message owes an update', () => {
  assert.equal(sendsMessage({ to: 'x' }), false);
  assert.equal(sendsMessage({ to: 'x', message: '' }), false);
  assert.equal(sendsMessage({ to: 'x', message: '   ' }), false);
  assert.equal(sendsMessage({ to: 'x', message: 'go on' }), true);
  assert.equal(sendsMessage({ to: 'x', message: { type: 'shutdown_request' } }), true);
  assert.equal(sendsMessage(undefined), false);
});

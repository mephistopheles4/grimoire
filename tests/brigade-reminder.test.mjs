// The roster reminder (issue 532), tested at its own seam: brigade/reminder.ts
// holds the rules with no engine import. The later tests read
// brigade/register.tsx's text for the wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { REMINDER_LINE, SEND_TOOL, endTurn, sendsMessage, tally } = await import('../brigade/reminder.ts');

const turn = (...calls) => {
  const t = { owed: false };
  for (const c of calls) tally(t, c);
  return endTurn(t);
};

test('a decision logged and sent, with no set_roster, ends with the reminder', () => {
  assert.equal(turn('decision', 'send'), REMINDER_LINE);
});

test('a set_roster after the last send or decision gets no reminder', () => {
  assert.equal(turn('decision', 'send', 'roster'), undefined);
});

test('a send after the last set_roster gets the reminder', () => {
  assert.equal(turn('roster', 'send'), REMINDER_LINE);
});

test('a turn with no send and no decision gets no reminder', () => {
  assert.equal(turn(), undefined);
});

test('an idle-subscription send carries no message, so it owes nothing', () => {
  assert.equal(sendsMessage({ to: 'x' }), false);
  assert.equal(sendsMessage({ to: 'x', message: '' }), false);
  assert.equal(sendsMessage({ to: 'x', message: '   ' }), false);
  assert.equal(sendsMessage({ to: 'x', message: 'go on' }), true);
  assert.equal(sendsMessage({ to: 'x', message: { type: 'shutdown_request' } }), true);
  assert.equal(sendsMessage(undefined), false);
});

test('the reminder is said once: the next turn starts clean', () => {
  const t = { owed: false };
  tally(t, 'send');
  assert.equal(endTurn(t), REMINDER_LINE);
  assert.equal(endTurn(t), undefined);
});

test('the wiring: SendMessage, log_decision and set_roster feed the tally, and the writer\'s turn end asks for the line', () => {
  const reg = fs.readFileSync(new URL('../brigade/register.tsx', import.meta.url), 'utf8');
  assert.equal(SEND_TOOL, 'SendMessage');
  assert.match(reg, /on\('tool\.call', \{ tool: SEND_TOOL \}/);
  assert.match(reg, /tally\(owedRoster, 'decision'\)/);
  assert.match(reg, /tally\(owedRoster, 'roster'\)/);
  assert.match(reg, /registerWriter\(on, e =>/);
  assert.match(reg, /endTurn\(owedRoster\)/);
  const writer = fs.readFileSync(new URL('../brigade/writer.ts', import.meta.url), 'utf8');
  assert.equal((writer.match(/on\('turn\.complete'/g) ?? []).length, 1);
});

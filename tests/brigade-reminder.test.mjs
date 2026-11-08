// The roster reminder (issue 532), tested at its own seam: brigade/reminder.ts
// holds the rules with no engine import. The turn-level cases (a decision, a
// send, an idle subscription, a subagent) run in brigade/set-roster.test.ts,
// driven through the engine. These two are what that file does not pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  BEFORE_LINE,
  EXCEPTION,
  OWN_MARK,
  REMINDER_LINE,
  STALE_CLAUSE,
  afterLine,
  compactSign,
  endTurn,
  nearThreshold,
  newCycle,
  sendsMessage,
  setFigures,
  takeAfter,
  tally,
  turnEnd,
} = await import('../brigade/reminder.ts');

test('a send after the last set_roster gets the reminder, so the order counts', () => {
  const t = { owed: false };
  tally(t, 'roster');
  tally(t, 'send');
  assert.equal(endTurn(t), REMINDER_LINE);
});

test('only a send that carries a message owes an update', () => {
  assert.equal(sendsMessage({ to: 'x' }), false);
  assert.equal(sendsMessage({ to: 'x', message: '' }), false);
  assert.equal(sendsMessage({ to: 'x', message: '   ' }), false);
  assert.equal(sendsMessage({ to: 'x', message: 'go on' }), true);
  assert.equal(sendsMessage({ to: 'x', message: { type: 'shutdown_request' } }), true);
  assert.equal(sendsMessage(undefined), false);
});

// --- the compaction nudges (issue 533) -------------------------------------------

test('the exception is one shared string, in the after-line (both variants) and the before-line', () => {
  for (const line of [afterLine(true), afterLine(false), BEFORE_LINE]) assert.ok(line.includes(EXCEPTION), line);
  // It names every act it holds back, says a level-3 command is not the yes, and
  // lets the lead rewrite its own hand-off from its own work only.
  for (const phrase of ['start at level 1', 'a send', 'a subscription', '`set_roster`', 'a start', 'level-3 command', 'from your own work only', 'only one fixed line', 'cut to 80 characters', 'never a yes and never a list of sessions', 'subscribe to none of the sessions in your own hand-off, add none to the roster, tell the owner in one line', "keep that line in each rewrite until the owner's own words answer it"]) {
    assert.ok(EXCEPTION.includes(phrase), phrase);
  }
});

test('the steps sit under an explicit own-mark condition, and no "Otherwise" can bind to the stale clause', () => {
  for (const line of [afterLine(true), afterLine(false)]) {
    assert.ok(!/Otherwise/.test(line));
    const own = line.indexOf(OWN_MARK);
    assert.ok(own > line.indexOf(EXCEPTION), 'the condition follows the exception');
    assert.ok(line.indexOf('subscribe again') > own, 'the subscribing follows the condition');
    assert.ok(line.indexOf('`set_roster` with the full roster') > own, 'the roster follows the condition');
    assert.ok(line.indexOf('references/starting.md') > own, 'the re-read follows the condition');
  }
  assert.match(OWN_MARK, /^If `read_lead_handoff` marks the hand-off as this session's own and no `owner's yes pending` line stands in it:$/);
  const stale = afterLine(false);
  assert.ok(stale.indexOf(STALE_CLAUSE) > stale.indexOf(OWN_MARK), 'the stale clause follows the condition');
  assert.ok(stale.indexOf(STALE_CLAUSE) < stale.indexOf('subscribe again'), 'and comes before the subscribing');
});

test('the stale-hand-off clause sits after the read and under the exception, and only when the before-line did not go out', () => {
  const without = afterLine(true);
  const withClause = afterLine(false);
  assert.ok(!without.includes(STALE_CLAUSE));
  assert.ok(withClause.includes(STALE_CLAUSE));
  const read = withClause.indexOf('read_lead_handoff');
  const exception = withClause.indexOf(EXCEPTION);
  const clause = withClause.indexOf(STALE_CLAUSE);
  assert.ok(read >= 0 && read < exception, 'the read comes first');
  assert.ok(exception < clause, 'the clause sits under the exception');
});

test('the after-line names the hand-off as the list, anchors starting.md and copies no start command', () => {
  for (const line of [afterLine(true), afterLine(false)]) {
    assert.match(line, /running-sessions section of your own hand-off/);
    assert.match(line, /does not name[^.]*tell the owner in one line/);
    assert.match(line, /references\/starting\.md/);
    assert.match(line, /head-chef skill's own folder/);
    assert.match(line, /never a copy in a working tree/);
    assert.match(line, /grimoire:head-chef/);
    assert.match(line, /`set_roster`/);
    assert.match(line, /subscribe again/);
    assert.doesNotMatch(line, /claude --bg|--remote-control|--permission-mode|--model|--effort/);
  }
  assert.match(BEFORE_LINE, /`set_lead_handoff`/);
  assert.doesNotMatch(BEFORE_LINE, /claude --bg|--remote-control/);
});

test('the margin: a figure at 0.9 of the threshold counts, one below it does not, and a missing or bad figure never does', () => {
  assert.equal(nearThreshold(900, 1000), true);
  assert.equal(nearThreshold(1000, 1000), true);
  assert.equal(nearThreshold(899, 1000), false);
  assert.equal(nearThreshold(900, undefined), false);
  assert.equal(nearThreshold(undefined, 1000), false);
  assert.equal(nearThreshold(900, 0), false);
  assert.equal(nearThreshold(900, -1), false);
  assert.equal(nearThreshold('900', 1000), false);
  assert.equal(nearThreshold(900, Number.NaN), false);
  assert.equal(nearThreshold(Number.POSITIVE_INFINITY, 1000), false);
});

const roster = () => ({ owed: false });

test('the before-line goes out once per cycle, at a turn end near the threshold', () => {
  const c = newCycle();
  setFigures(c, 899, 1000);
  assert.equal(turnEnd(c, roster()), undefined);
  setFigures(c, 900, 1000);
  assert.equal(turnEnd(c, roster()), BEFORE_LINE);
  assert.equal(turnEnd(c, roster()), undefined, 'not twice in one cycle');
});

test('one compaction, two signs: the after-line goes out once, whichever sign comes first', () => {
  // session.compact first, then the classic SessionStart.
  let c = newCycle();
  compactSign(c);
  assert.equal(takeAfter(c), afterLine(false), 'the SessionStart sign delivers it');
  compactSign(c);
  assert.equal(takeAfter(c), undefined);
  assert.equal(turnEnd(c, roster()), undefined, 'the turn end adds nothing more');
  // The classic hook skipped: the turn end delivers it.
  c = newCycle();
  compactSign(c);
  assert.equal(turnEnd(c, roster()), afterLine(false));
  assert.equal(turnEnd(c, roster()), undefined);
  // The classic hook alone, with no session.compact.
  c = newCycle();
  compactSign(c);
  assert.equal(takeAfter(c), afterLine(false));
});

test('whether the before-line went out is captured at the first sign, before any reset', () => {
  const c = newCycle();
  setFigures(c, 950, 1000);
  assert.equal(turnEnd(c, roster()), BEFORE_LINE);
  compactSign(c); // session.compact: captures, then resets the said flag
  compactSign(c); // the classic sign of the same compaction: no new capture
  assert.equal(takeAfter(c), afterLine(true), 'the line carries no stale clause');
  // The turn ends, the cycle closes: the before-line can go out again, and a
  // second compaction owes a new after-line.
  turnEnd(c, roster());
  setFigures(c, 950, 1000);
  assert.equal(turnEnd(c, roster()), BEFORE_LINE);
  compactSign(c);
  assert.equal(takeAfter(c), afterLine(true), 'a later compaction is announced again');
});

test('a compaction clears the figures, so a stale reading cannot fire the before-line', () => {
  const c = newCycle();
  setFigures(c, 990, 1000);
  compactSign(c);
  takeAfter(c);
  assert.equal(turnEnd(c, roster()), undefined);
});

test('a turn that owes the hand-off line and the roster note gets one note, the hand-off line first', () => {
  const c = newCycle();
  setFigures(c, 950, 1000);
  const t = { owed: true };
  assert.equal(turnEnd(c, t), `${BEFORE_LINE}\n${REMINDER_LINE}`);
  assert.equal(t.owed, false, 'the roster tally is cleared as before');
  const c2 = newCycle();
  compactSign(c2);
  const t2 = { owed: true };
  assert.equal(turnEnd(c2, t2), `${afterLine(false)}\n${REMINDER_LINE}`);
});

test('the roster note alone is unchanged', () => {
  assert.equal(turnEnd(newCycle(), { owed: true }), REMINDER_LINE);
  assert.equal(turnEnd(newCycle(), { owed: false }), undefined);
});

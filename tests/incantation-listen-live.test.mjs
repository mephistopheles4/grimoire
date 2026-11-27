// More tests of listen.mjs, from the listener the prototype proved onward
// (S5.1 to S5.7 and what followed); its "claim N" titles are numbered apart
// from S6's claims. "live" names the live() helper below, a started rig that
// has answered ready: every test here runs on fakes. The rest are in
// incantation-listen.test.mjs. A new test goes in whichever file keeps their
// run times close.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { SPINNERS, ask, leadSilence, pickSpinner, readChannel, say, stopRecorder, waitLines } from '../skills/incantation/scripts/listen.mjs';
import { deviceDigest, ensureKey, observeDir, runDir, settingsPath, writeWhole } from '../skills/incantation/scripts/lib.mjs';
import { LISTEN, RECORDER, PARSED, makeHome, rig, wait, tick, within, statusOf, texts, cli, spoken } from './incantation-listen-fixture.mjs';

// ---- GRIM-36 ticket 2 (S5.1 to S5.7): the listener the prototype proved ----

const voiceOf = home => readFileSync(join(runDir(home), 'voice'), 'utf8').trim();
const raced = (promise, ms = 300) => within(promise, ms, 'still waiting');
const live = async (t, options) => {
  const r = rig(options);
  t.after(r.cleanup);
  const l = await r.start();
  t.after(() => l.stop());
  assert.match(await wait(r.home), /^ready /m);
  return r;
};

test('claim 3: working, mute-voice and unmute-voice answer fixed lines, and the status word and the voice file follow', async t => {
  const r = await live(t);
  assert.equal(voiceOf(r.home), 'on');
  assert.equal(await cli(r.home, 'working'), 'working\n');
  assert.equal(await cli(r.home, 'status'), 'working\n');
  assert.equal(statusOf(r.home), 'working');
  assert.equal(await cli(r.home, 'mute-voice'), 'voice-muted\n');
  assert.equal(voiceOf(r.home), 'muted');
  assert.equal(await cli(r.home, 'unmute-voice'), 'voice-unmuted\n');
  assert.equal(voiceOf(r.home), 'on');
  assert.equal(await ask({ ...readChannel(r.home), token: '0'.repeat(64) }, 'mute-voice', 1000), null, 'no voice mute without the token');
});

test('claim 3: a working word lapses after workingMs, ends on a line spoken, and ends on a turn heard', async t => {
  const r = await live(t, { knobs: { workingMs: 300 } });
  assert.equal(await cli(r.home, 'working'), 'working\n');
  r.push(1000, 34); // 1 s on the fake clock: past workingMs
  assert.equal(await cli(r.home, 'status'), 'listening\n', 'lapsed');
  assert.equal(await cli(r.home, 'working'), 'working\n');
  assert.equal(await spoken(r, 'A line.'), 'speaking\n');
  r.player.plays[0].end();
  await tick(30);
  assert.notEqual(await cli(r.home, 'status'), 'working\n', 'a spoken line ends it');
  const again = await live(t);
  assert.equal(await cli(again.home, 'working'), 'working\n');
  again.turn();
  await tick(80);
  assert.notEqual(await cli(again.home, 'status'), 'working\n', 'a heard turn ends it');
});

test('claim 3: a muted voice makes no synthesis call and plays nothing, and the say still counts as played', async t => {
  const r = await live(t, { engineOptions: { text: 'Yes.' } });
  await tick(100); // the spinner words are made after ready: count only what comes after
  const before = r.engine.synthesized.length;
  assert.equal(await cli(r.home, 'mute-voice'), 'voice-muted\n');
  assert.equal(await spoken(r, 'Shall I go on?'), 'speaking\n');
  assert.equal(r.engine.synthesized.length, before, 'no generation for a muted line');
  assert.equal(r.player.plays.length, 0, 'nothing played');
  r.player.spinners.length = 0;
  r.turn(); // the person says yes
  await tick(80);
  const out = await wait(r.home);
  assert.match(out, /^Heard \(after reply\): "Yes\."$/m, 'a reply, though nobody heard the line');
  assert.match(out, /^plays 1$/m, 'the say is counted');
  assert.equal(r.player.spinners.length, 0, 'and no spinner word plays on a muted voice');
  assert.equal(await cli(r.home, 'unmute-voice'), 'voice-unmuted\n');
});

test('claim 3: a listener older than a command closes the connection, and the client says a restart is needed; with none running it says so', async t => {
  const home = makeHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const token = '1'.repeat(64);
  const server = (await import('node:net')).createServer(socket => {
    socket.on('error', () => {});
    socket.once('data', d => {
      if (String(d).startsWith('ping ')) return void socket.end('alive\n');
      socket.destroy(); // a command this older listener does not know
    });
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  t.after(() => server.close());
  writeWhole(join(runDir(home), 'listen.json'), JSON.stringify({ port: server.address().port, token }));
  const run = (h, command) =>
    new Promise(res => execFile(process.execPath, [LISTEN, command], { env: { ...process.env, HOME: h, USERPROFILE: h }, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res(stdout)));
  for (const command of ['working', 'mute-voice', 'unmute-voice']) assert.equal(await run(home, command), 'listener: restart needed for this command\n', command);
  const none = makeHome();
  t.after(() => rmSync(none, { recursive: true, force: true }));
  assert.equal(await run(none, 'working'), 'listener: not running\n');
});

test('claim 4: a kept turn plays one spinner word within 100 ms, never the same twice running over 50 turns, and it is not counted in plays', async t => {
  const r = await live(t, { engineOptions: { text: 'Run the tests.' } });
  await tick(120); // the ten words are made after ready
  const seen = [];
  for (let i = 0; i < 50; i++) {
    r.t += 1600; // a person's next sentence comes more than echoHoldMs after the last cue
    r.turn();
    await tick(70);
    assert.equal(r.player.spinners.length, i + 1, `turn ${i}: one word, within the pause`);
    seen.push(r.player.spinners[i].word);
  }
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], 'never the same twice running');
  assert.equal(new Set(seen).size > 5, true, 'a spread of the ten words');
  assert.ok(seen.every(w => SPINNERS.includes(w)));
  assert.equal(r.player.plays.length, 0, 'a spinner is not a reply');
  const out = await wait(r.home);
  assert.match(out, /^plays 0$/m);
});

test('follow-up 1: the spinner word plays when the gate hears the end of speech, before the turn is transcribed', async t => {
  const r = await live(t, { engineOptions: { text: () => new Promise(res => setTimeout(() => res('Run the tests.'), 400)) } });
  await tick(120);
  r.turn();
  await tick(100); // well before the transcript is back
  assert.equal(r.player.spinners.length, 1, 'the cue came with the end of speech, not after the text');
  assert.equal(r.engine.calls, 1, 'and the engine is still working on the turn');
  const pending = wait(r.home);
  assert.equal(await raced(pending, 100), 'still waiting', 'nothing delivered yet');
  assert.match(await pending, /^Heard: "Run the tests\."$/m);
});

test('follow-up 1: a cue that turns out to be for a stop word, a mute word or a fragment is cut short; none for a muted mic or a muted voice, and one for a turn over a line', async t => {
  const words = ['stop', 'Mute.', 'Unmute.', 'you', 'Run the tests.'];
  const r = await live(t, { engineOptions: { text: texts(...words) } });
  await tick(120);
  const turn = () => {
    r.t += 1600; // each sentence comes more than echoHoldMs after the last sound
    r.turn();
  };
  turn(); // stop
  await tick(70);
  assert.equal(r.player.spinners.length, 1);
  assert.equal(r.player.spinners[0].stopped, true, 'a stop word: the stray cue is stopped as soon as the text says so');
  turn(); // mute
  await tick(70);
  assert.equal(r.player.spinners.length, 2);
  assert.equal(r.player.spinners[1].stopped, true, 'a mute word: stopped');
  turn(); // unmute, said while the mic is muted: heard for that word only, so no cue
  await tick(70);
  assert.equal(r.player.spinners.length, 2, 'none while the mic is muted');
  turn(); // a fragment
  await tick(70);
  assert.equal(r.player.spinners.length, 3);
  assert.equal(r.player.spinners[2].stopped, true, 'a fragment: stopped');
  // A person who talks over a line still gets the cue: it always plays when a turn ends.
  assert.equal(await spoken(r, 'First line.'), 'speaking\n');
  turn();
  await tick(70);
  assert.equal(r.player.spinners.length, 4, 'a cue over a line');
  // A muted voice plays nothing.
  assert.equal(await cli(r.home, 'mute-voice'), 'voice-muted\n');
  turn();
  await tick(70);
  assert.equal(r.player.spinners.length, 4, 'none while the voice is muted');
});

test('follow-up 1: a quick turn inside the echo window still gets a cue, and our own sound heard back is stopped and not delivered', async t => {
  const r = await live(t, { engineOptions: { text: texts('Run the tests.', 'One sec.') } });
  await tick(120);
  r.turn();
  await tick(70);
  assert.equal(r.player.spinners.length, 1);
  r.push(3163, 12); // the mic hears the spinner word's own tail, within echoHoldMs of its end
  r.push(1000, 15);
  await tick(150);
  assert.ok(r.player.spinners.length >= 1, 'the first cue played');
  const out = await wait(r.home);
  assert.match(out, /^Heard: "Run the tests."$/m);
  assert.doesNotMatch(out, /One sec/, 'our own word is not a turn');
});

test('follow-up 2: a say queued behind a playing line holds while a new turn is being heard, and plays when it is dropped or is held when a turn lands', async t => {
  const r = await live(t, { engineOptions: { text: texts('you', 'Hold on.') } });
  r.push(1000, 34);
  const channel = readChannel(r.home);
  assert.equal(await say(channel, 'First line.', 3000), 'speaking\n');
  let answered = null;
  const queued = say(channel, 'Second line.', 3000).then(v => ((answered = v), v));
  await tick(40);
  r.push(3163, 5); // the person begins a new turn, short of a barge-in
  assert.equal(r.player.stops, 0);
  r.player.plays[0].end(); // the first line ends: the queued one would start now
  await tick(250);
  assert.equal(answered, null, 'held while they talk');
  assert.equal(r.player.plays.length, 1, 'and not started');
  r.push(1000, 15); // a fragment: dropped
  assert.equal(await queued, 'speaking\n', 'played once they stopped');
  assert.equal(r.player.plays.length, 2);
  r.player.plays[1].end();
  await tick(30);
  // The same again, with a turn that lands.
  assert.equal(await say(channel, 'Third line.', 3000), 'speaking\n');
  const fourth = say(channel, 'Fourth line.', 3000);
  await tick(40);
  r.push(1000, 34);
  r.push(3163, 5);
  r.player.plays[2].end();
  await tick(150);
  assert.equal(r.player.plays.length, 3, 'held');
  r.push(3163, 5);
  r.push(1000, 15);
  assert.equal(await fourth, 'say-held\n', 'a turn landed: the line is stale');
  assert.equal(r.player.plays.length, 3);
});

test('claim 4: the 150 ms of silence in front of a spinner word keeps the WAV valid, and anything else is returned as it came', () => {
  const rate = 24000;
  const data = Buffer.alloc(2000, 5);
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(data.length, 40);
  const whole = Buffer.concat([wav, data]);
  const led = leadSilence(whole);
  const pad = Math.round(rate * 0.15) * 2;
  assert.equal(led.length, whole.length + pad);
  assert.equal(led.readUInt32LE(40), data.length + pad);
  assert.equal(led.readUInt32LE(4), 36 + data.length + pad);
  assert.ok(led.subarray(44, 44 + pad).every(b => b === 0), 'silence first');
  assert.ok(led.subarray(44 + pad).equals(data), 'then the word');
  const odd = Buffer.from('RIFF-made-up-audio');
  assert.equal(leadSilence(odd), odd);
  assert.equal(pickSpinner(10, 3, () => 0.999) !== 3, true);
  for (let i = 0; i < 200; i++) assert.notEqual(pickSpinner(10, 7), 7);
  assert.equal(pickSpinner(1, 0), 0, 'one word has no other to pick');
});

test('claim 5: with the status working and no line or turn for progressMs, a wait ends with progress-due, again after another progressMs, and not after a line or a turn', async t => {
  const r = await live(t, { knobs: { progressMs: 600 } });
  r.push(1000, 34);
  assert.equal(await cli(r.home, 'working'), 'working\n');
  const first = wait(r.home);
  r.push(1000, 19); // 570 ms on the fake clock
  assert.equal(await raced(first, 100), 'still waiting', 'not yet');
  r.push(1000, 2);
  assert.equal(await first, 'progress-due\n', 'a notice the session acts on ends the wait');
  const second = wait(r.home);
  r.push(1000, 21);
  assert.equal(await second, 'progress-due\n', 'and again after another beat');
  // A line spoken ends the working state: no more beats until the session says working again.
  assert.equal(await spoken(r, 'Still on it.'), 'speaking\n');
  r.player.plays[0].end();
  const third = wait(r.home);
  r.push(1000, 60);
  assert.equal(await raced(third, 150), 'still waiting');
  // Working again, then a heard turn: it ends the state and the turn is what the wait gets.
  assert.equal(await cli(r.home, 'working'), 'working\n');
  r.push(3163, 12);
  r.push(1000, 15);
  const out = await third;
  assert.match(out, /^Heard \(after reply\): "hello there"$/m, 'after the progress line the session spoke');
  assert.doesNotMatch(out, /progress-due/);
  const fourth = wait(r.home);
  r.push(1000, 80);
  assert.equal(await raced(fourth, 150), 'still waiting', 'no beat after a turn was heard');
});

test('claim 5: a repeat of working does not push the beat back', async t => {
  const r = await live(t, { knobs: { progressMs: 600 } });
  r.push(1000, 34);
  assert.equal(await cli(r.home, 'working'), 'working\n');
  const pending = wait(r.home);
  for (let i = 0; i < 4; i++) {
    r.push(1000, 6);
    assert.equal(await cli(r.home, 'working'), 'working\n');
  }
  r.push(1000, 2);
  assert.equal(await pending, 'progress-due\n');
});

test('claim 6: a kept turn during a line stops it, drops the lines queued behind it with say-held, and the next delivery says interrupted', async t => {
  const r = await live(t, { engineOptions: { text: 'Hold on.' } });
  r.push(1000, 34);
  const channel = readChannel(r.home);
  assert.equal(await say(channel, 'First line.', 3000), 'speaking\n');
  const queued = say(channel, 'Second line.', 3000);
  await tick(40);
  r.push(3163, 11); // a short turn: under the barge-in, so the kept turn itself is what moves on
  assert.equal(r.player.stops, 0, 'no barge-in yet');
  r.push(1000, 15);
  await tick(80);
  assert.equal(r.player.stops, 1, 'the line in the player is stopped');
  assert.equal(await queued, 'say-held\n', 'the queued line never plays');
  assert.equal(r.player.plays.length, 1);
  const out = await wait(r.home);
  assert.match(out, /^Heard \(after reply\): "Hold on\."$/m);
  assert.match(out, /^interrupted$/m);
});

test('claim 7: the saved mic is found by its digests, a changed list falls back to a mic that is not a loopback and names it before ready, and nothing is named otherwise', async t => {
  const dev = PARSED[process.platform] ?? PARSED.linux;
  // The saved mic, by the digest of its id.
  const home = makeHome({ device: { index: 5, stamp: '0123456789abcdef' } });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const key = ensureKey(home);
  writeWhole(settingsPath(home), JSON.stringify({ engine: 'sherpa', profile: 'everly', device: { index: 5, stamp: '0123456789abcdef', id: deviceDigest(key, dev[0].id), name: deviceDigest(key, 'another name') }, recorder: RECORDER, endOfSpeechMs: 300 }));
  const saved = rig({ home });
  const sl = await saved.start();
  assert.doesNotMatch(await wait(home), /mic-fallback/);
  await sl.stop();
  // Settings from before (no id or name): by stamp and index.
  const old = rig({ settings: {} });
  t.after(old.cleanup);
  const ol = await old.start();
  assert.doesNotMatch(await wait(old.home), /mic-fallback/);
  await ol.stop();
  // The saved mic is gone: the first mic that is not a loopback, said before ready.
  const gone = rig({ settings: { device: { index: 0, stamp: '0123456789abcdef' } } });
  t.after(gone.cleanup);
  const gl = await gone.start();
  const out = await wait(gone.home);
  const lines = out.trim().split('\n');
  assert.equal(lines[lines.indexOf(`mic-fallback "${dev[0].name}"`) + 1].startsWith('ready '), true, 'named just before ready');
  assert.equal(gone.recorder.spawned.length, 1);
  await gl.stop();
  // Said once: the first delivery only.
  const again = rig({ settings: { device: { index: 0, stamp: '0123456789abcdef' } }, engineOptions: { text: 'hello there' } });
  t.after(again.cleanup);
  const al = await again.start();
  assert.match(await wait(again.home), /^mic-fallback /m);
  again.turn();
  await tick(80);
  assert.doesNotMatch(await wait(again.home), /mic-fallback/);
  await al.stop();
});

test('claim 7: a fallback name is printed cleaned (letters, digits, spaces and ()-_.), and wait lets the line through', () => {
  assert.equal(waitLines('mic-fallback "Desk Mic One (USB)"\n'), 'mic-fallback "Desk Mic One (USB)"\n');
  assert.equal(waitLines('mic-fallback "bad\\"quote"\nmic-fallback ""\n'), '', 'quotes and backslashes never pass, nor an empty name');
  assert.equal(waitLines('progress-due\n'), 'progress-due\n');
});

test('S5.7: a turn begun over a reply is flagged overlap, so a spinner word heard back by the mic is not delivered', async t => {
  const r = await live(t, { engineOptions: { text: texts('Pondering.', 'Run the tests.') } });
  await tick(120);
  r.push(1000, 34);
  assert.equal(await spoken(r, 'A line.'), 'speaking\n');
  r.player.plays[0].end();
  await tick(30);
  r.push(3163, 12); // the mic hears the speaker's own tail: a turn over the end of a reply
  r.push(1000, 15);
  await tick(60);
  assert.equal(await raced(wait(r.home), 150), 'still waiting', 'our own spinner word, heard back, is not a turn');
});

// The two bugs the owner hit (idle and say over a person mid-sentence; a long turn cut and its rest lost).

test('bug b: idle holds while a turn is being heard and returns once it has been settled', async t => {
  const r = await live(t, { engineOptions: { text: 'Run the tests.' } });
  r.push(1000, 34);
  r.push(3163, 5); // the person is mid-sentence
  assert.equal(statusOf(r.home), 'hearing');
  let settled = false;
  const pending = cli(r.home, 'idle').then(v => ((settled = true), v));
  await tick(200);
  assert.equal(settled, false, 'held while a turn is being heard');
  r.push(3163, 10);
  await tick(100);
  assert.equal(settled, false, 'and while the voice goes on');
  r.push(1000, 15); // the turn ends: its text must settle first
  assert.equal(await pending, 'idle\n');
  assert.equal(r.engine.calls, 1, 'idle came back after the text was settled, not before');
});

test('bug b: a say waits while the person is mid-sentence and then speaks when that turn was a fragment; when the turn is kept the line is stale and is held', async t => {
  const r = await live(t, { engineOptions: { text: texts('you', 'Hold on.') } });
  r.push(1000, 34);
  const channel = readChannel(r.home);
  r.push(3163, 5); // mid-sentence
  let answered = null;
  const line = say(channel, 'A reply that must not talk over them.', 3000).then(v => ((answered = v), v));
  await tick(250);
  assert.equal(answered, null, 'not answered while they talk');
  assert.equal(r.player.plays.length, 0, 'and nothing plays over them');
  r.push(1000, 15); // the turn is a fragment: dropped
  assert.equal(await line, 'speaking\n', 'the line goes on once the turn is settled and dropped');
  assert.equal(r.player.plays.length, 1);
  r.player.plays[0].end();
  await tick(30);
  // A turn that is kept: the line waiting is stale.
  r.push(1000, 34);
  r.push(3163, 5);
  const stale = say(channel, 'A second reply.', 3000);
  await tick(150);
  assert.equal(r.player.plays.length, 1);
  r.push(3163, 5);
  r.push(1000, 15);
  assert.equal(await stale, 'say-held\n', 'what they said is newer than the line');
  assert.equal(r.player.plays.length, 1, 'never played');
});

test('bug b: a line waits at most holdSayMs for the person to finish, then fails rather than speak over them', async t => {
  const r = await live(t, { knobs: { holdSayMs: 200 } });
  r.push(1000, 34);
  r.push(3163, 5);
  assert.equal(await say(readChannel(r.home), 'Too late.', 3000), 'say-failed\n');
  assert.equal(r.player.plays.length, 0);
});

test('GRIM-67: with the mic muted the session still speaks: talk at the muted mic holds no line and no idle wait', async t => {
  const r = await live(t, { knobs: { holdSayMs: 200 } });
  r.push(1000, 34);
  assert.equal(await cli(r.home, 'mute'), 'mic-muted\n');
  r.push(3163, 5); // a turn is open: the person is talking to someone else
  assert.equal(await cli(r.home, 'idle'), 'idle\n');
  assert.equal(await say(readChannel(r.home), 'Still here.', 3000), 'speaking\n');
  assert.equal(r.player.plays.length, 1);
});

test('GRIM-67: with the mic muted the progress beat still runs, through talk at the muted mic', async t => {
  const r = await live(t, { knobs: { progressMs: 600 } });
  r.push(1000, 34);
  assert.equal(await cli(r.home, 'mute'), 'mic-muted\n');
  assert.equal(await cli(r.home, 'working'), 'working\n');
  const pending = wait(r.home);
  r.push(3163, 21);
  assert.match(await pending, /^progress-due$/m);
});

const longTurn = r => {
  r.push(1000, 34);
  r.push(3163, 1010); // more than 30 s: cut at the limit, the rest goes on as the next turn
  r.push(1000, 15);
};

test('bug a: a turn cut at 30 s and its rest reach the session as one turn, in order, with nothing lost', async t => {
  const r = await live(t, { engineOptions: { text: texts('This is the first part of a long turn.', 'And this is the rest of it.') } });
  longTurn(r);
  await tick(150);
  const out = await wait(r.home);
  assert.match(out, /^Heard: "This is the first part of a long turn\. And this is the rest of it\."$/m);
  assert.equal(r.engine.calls, 2);
  assert.equal(r.player.spinners.length, 1, 'one cue for the whole turn, at its end, not one at the cut');
  assert.doesNotMatch(out, /stt-dropped/);
});

// GRIM-51: the cue means "you stopped". A cut for length is not a stop. The waits
// let a spinner word that did play end, so a second one could not hide behind it.
test('GRIM-51: no spinner word plays at a cut for length; one plays when the person stops', async t => {
  const r = await live(t, { engineOptions: { text: texts('This is the first part.', 'And the rest.') } });
  await tick(120);
  r.push(1000, 34);
  r.push(3163, 1010); // past the limit, and still talking
  await tick(100);
  assert.equal(r.player.spinners.length, 0, 'nothing while they talk');
  r.push(1000, 15);
  await tick(100);
  assert.equal(r.player.spinners.length, 1, 'one at the end');
});

test('GRIM-51: a person who stops right at the cut still gets one spinner word, whether silence follows or only a click', async t => {
  for (const click of [false, true]) {
    const r = await live(t, { engineOptions: { text: 'a lone part with no rest' } });
    await tick(120);
    r.push(1000, 34);
    r.push(3163, 1000); // exactly the limit
    await tick(100);
    assert.equal(r.player.spinners.length, 0, 'none at the cut itself');
    if (click) r.push(3163, 2); // too short to be a turn
    r.push(1000, 60);
    await tick(100);
    assert.equal(r.player.spinners.length, 1, click ? 'after a click' : 'after silence');
    assert.match(await within(wait(r.home), 2000, 'never'), /^Heard: "a lone part with no rest"$/m);
  }
});

test('GRIM-51: a cut part that was lost or was only noise, with no rest, gets no spinner word', async t => {
  for (const text of [null, 'you']) {
    const r = await live(t, { engineOptions: { text: () => text } });
    await tick(120);
    r.push(1000, 34);
    r.push(3163, 1000); // exactly the limit
    await tick(100); // its text has settled before the chain ends
    r.push(1000, 60);
    await tick(100);
    assert.equal(r.player.spinners.length, 0, String(text));
  }
});

test('bug a: a cut turn that ends on no sentence mark still waits for its rest, and its rest that is lost is said at once', async t => {
  let calls = 0;
  const r = await live(t, { engineOptions: { text: () => (calls++ === 0 ? 'first part with no end' : null) } });
  longTurn(r);
  const out = await within(wait(r.home), 2000, 'never');
  assert.match(out, /^Heard: "first part with no end"$/m, 'the part we have is delivered, not held for ever');
  assert.match(out, /^stt-dropped$/m, 'and the loss is named in the same delivery, which ended the wait');
});

test('bug a: a cut turn whose rest is a fragment delivers the first part at once, and one with no rest at all is not held for the long bound', async t => {
  const r = await live(t, { engineOptions: { text: texts('only the first part', 'you') } });
  longTurn(r);
  assert.match(await within(wait(r.home), 2000, 'never'), /^Heard: "only the first part"$/m);
  const lone = await live(t, { engineOptions: { text: 'a lone part with no rest' } });
  lone.push(1000, 34);
  lone.push(3163, 1000); // exactly the limit, then silence: nothing continues it
  lone.push(1000, 20);
  const out = await within(wait(lone.home), 2000, 'never');
  assert.match(out, /^Heard: "a lone part with no rest"$/m, 'the gate said no rest came');
});

test('bug a: a long heard text is split into several lines at word ends and none of it is cut', async t => {
  const words = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');
  const r = await live(t, { engineOptions: { text: words } });
  r.turn();
  await tick(150);
  const out = await wait(r.home);
  const lines = out.split('\n').filter(l => l.startsWith('Heard'));
  assert.ok(lines.length >= 3);
  assert.equal(lines.map(l => l.replace(/^Heard(?: \(after reply\))?: "/, '').replace(/"$/, '')).join(' '), words);
});

test('S5.6: the voice file reads on or muted while a listener runs, and goes with it', async t => {
  const r = rig();
  t.after(r.cleanup);
  const l = await r.start();
  assert.equal(voiceOf(r.home), 'on');
  await cli(r.home, 'mute-voice');
  assert.equal(voiceOf(r.home), 'muted');
  await l.stop();
  assert.equal(existsSync(join(runDir(r.home), 'voice')), false);
});

test('claim 12 (listener side): the click file accepts mute-voice and unmute-voice, read once and removed', async t => {
  const r = await live(t);
  const click = join(runDir(r.home), 'command');
  writeFileSync(click, 'mute-voice');
  await tick(400);
  assert.equal(voiceOf(r.home), 'muted');
  assert.equal(existsSync(click), false);
  writeFileSync(click, 'unmute-voice');
  await tick(400);
  assert.equal(voiceOf(r.home), 'on');
});

// GRIM-53: a line written before the session has seen a heard turn is not played over it.

test('GRIM-53: a say that lands while a kept turn is undelivered is held and plays nothing; once a wait delivers the turn, a say plays', async t => {
  const r = await live(t, { engineOptions: { text: 'Actually, make it the other file.' } });
  r.turn(); // kept and queued; no wait has delivered it
  await tick(80);
  const channel = readChannel(r.home);
  assert.equal(await say(channel, 'Running the tests now.', 3000), 'say-held\n', 'the line was written without the turn in hand');
  assert.equal(r.player.plays.length, 0, 'nothing plays');
  assert.equal(r.engine.synthesized.length, 0, 'and no audio is made');
  const out = await wait(r.home);
  assert.match(out, /^Heard: "Actually, make it the other file\."$/m, 'the turn is still delivered');
  assert.match(out, /^plays 0$/m, 'a held line is no play');
  assert.equal(await say(channel, 'Switching to the other file.', 3000), 'speaking\n', 'with the turn seen, the session may speak');
  assert.equal(r.player.plays.length, 1);
});

test('GRIM-53: a line already waiting when a kept turn lands is held, and a held line counts no play', async t => {
  const r = await live(t, { engineOptions: { text: 'Hold on, wrong branch.' } });
  const channel = readChannel(r.home);
  r.push(1000, 34);
  r.push(3163, 5); // the person is mid-sentence
  const line = say(channel, 'Merging it now.', 3000);
  await tick(150);
  assert.equal(r.player.plays.length, 0, 'nothing plays over them');
  r.push(3163, 5);
  r.push(1000, 15); // the turn is kept
  assert.equal(await line, 'say-held\n', 'the session is told the line was held');
  assert.equal(r.player.plays.length, 0);
  assert.match(await wait(r.home), /^plays 0$/m, 'a held line is no play');
});

test('GRIM-53: a line whose audio is still being made when a kept turn lands is held, and nothing plays', async t => {
  const slow = () => new Promise(res => setTimeout(() => res(Buffer.from('RIFF-slow-audio')), 300));
  const r = await live(t, { engineOptions: { text: 'Wait, not that one.', synth: slow } });
  const line = say(readChannel(r.home), 'Deleting it now.', 3000);
  await tick(60); // the engine is still making the audio
  r.turn(); // a turn is kept meanwhile
  assert.equal(await line, 'say-held\n');
  assert.equal(r.player.plays.length, 0);
});

test('GRIM-53: a say that lands while the first part of a turn waits for its rest is held at once', async t => {
  const r = await live(t, { engineOptions: { text: 'the first part with no end' }, knobs: { joinMs: 5000 } });
  r.turn(); // kept, but it ends on no sentence mark: held for its rest, so not yet queued
  await tick(150);
  assert.equal(await raced(say(readChannel(r.home), 'Running it now.', 3000), 500), 'say-held\n', 'held at once, not waiting for the rest');
  assert.equal(r.player.plays.length, 0);
});

test('GRIM-53: the say command prints say-held for a held line, and deletes its file', async t => {
  const r = await live(t, { engineOptions: { text: 'Actually, stop.' } });
  r.turn();
  await tick(80);
  const file = join(observeDir(r.home), 'say-abcd1236.txt');
  writeFileSync(file, 'A line the turn overtook.');
  const out = await new Promise(res => {
    const env = { ...process.env, HOME: r.home, USERPROFILE: r.home };
    execFile(process.execPath, [LISTEN, 'say', 'abcd1236'], { env, encoding: 'utf8', timeout: 15_000 }, (e, stdout) => res(stdout));
  });
  assert.equal(out, 'say-held\n', 'not "listener: not running"');
  assert.equal(existsSync(file), false);
  assert.equal(r.player.plays.length, 0);
});

// GRIM-57: on macOS, `listen.mjs stop` left the avfoundation recorder running
// with parent PID 1. It ignored SIGTERM and ended on SIGINT.
const stubbornRecorder = endsOn => {
  const child = new EventEmitter();
  child.signals = [];
  child.kill = (signal = 'SIGTERM') => {
    child.signals.push(signal);
    if (endsOn.includes(signal)) setTimeout(() => child.emit('exit', null, signal), 5);
    return true;
  };
  return child;
};

test('GRIM-57: stop ends the macOS recorder with SIGINT, the signal it answers', async () => {
  const child = stubbornRecorder(['SIGINT']);
  const exited = new Promise(r => child.once('exit', r));
  await stopRecorder(child, exited, { platform: 'darwin', graceMs: 200 });
  assert.deepEqual(child.signals, ['SIGINT']);
});

test('GRIM-57: a recorder that ignores the stop signal is killed once the grace is over, so it outlives no listener', async () => {
  const child = stubbornRecorder(['SIGKILL']);
  let gone = false;
  const exited = new Promise(r => child.once('exit', () => r((gone = true))));
  await stopRecorder(child, exited, { platform: 'linux', graceMs: 50 });
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(gone, true, 'stop returns once the recorder has exited');
});

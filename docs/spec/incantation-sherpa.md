# Incantation on sherpa-onnx: what the prototype taught us

Draft 1, for issue #646. The prototype `prototypes/incantation-sherpa/` ran
incantation on local engines (sherpa-onnx, Phonon) in place of Voicebox, and
was tried live by voice on 2026-11-19 to 2026-11-21. This spec records what
held, what failed and how it was fixed, so the real build starts from it. It
is not reviewed. Every choice carries the tag of the owner's words it comes
from (S1); a choice with no tag is the spec's own.

## S1. The owner's words

Spoken in the live sessions unless marked typed.

- **W1 (typed):** "the mic picks up the voice of incantation itself, how can we
  fix that? are there standards for this online?"
- **W2 (typed):** "can we test it with audio clips with noise from online?"
- **W3 (typed):** "fallback to a mic and say which we are using?"
- **W4 (typed):** "without my own noise cancelling almost all noises count as
  barge in or speech, the threashold it too low, you hear the keyboard"
- **W5:** "The voice cue doesn't sound good being played on the voice model"
- **W6:** cues "from the words that [Claude] Code uses every day, like
  [julienning] and combobulating" (heard as "Cloud", "julianing")
- **W7:** "I expect the audio cues to play directly when I say something"
- **W8:** "You are sending me Windows [notifications] (heard as \"modifications\") which make a little bleep,
  and then that bleep makes a word and you react to that word."
- **W9:** "when I say something and I would stop ... and then I say something
  else, you're gonna reply to me once" (a pause splits a turn)
- **W10:** "That but rule is a bit too extreme and it should be deleted."
- **W11 (earlier, #646):** accuracy and no Voicebox upkeep matter, not speed.

## S2. Engines

- **Hearing:** Parakeet through sherpa-onnx-node 1.13.8, kept loaded. About
  0.1 to 0.6 s per turn on CPU; as accurate as Whisper on the owner's
  captures (W11).
- **Voice:** Kokoro 1.0 full (Bella) or Phonon (Everly), kept loaded in a
  worker. The owner prefers either to the small CPU voices.
- **Speech detector:** Silero VAD through sherpa-onnx, 643 KB.

## S3. Echo: the mic hears the speaker (W1, W2, W8)

What works, in order of the fixes:

1. **Acoustic echo cancellation,** WebRTC AEC3 through the `livekit` Python
   package (1.3.0) in its own worker, 10 ms frames at 16 kHz. Tuned on 48 AEC
   Challenge clips (MIT), half held out (W2).
2. **A steady delay.** One player for the session, paced by the mic's own
   frames; a player per line moved the delay by 70 ms and leaked about a
   second of echo at each line start. On Windows the capture buffer is 50 ms
   (`-audio_buffer_size 50`); the default 500 ms swung the delay by 300 ms.
3. **The right reference.** The canceller's reference is everything the
   speaker plays: WASAPI loopback of the default output (`engines/loopback.ps1`,
   C# through `Add-Type`, nothing to install), kept at most 100 ms ahead of the
   mic. With only the player's own samples, a notification bleep reached the
   transcriber as a word and became a turn (W8). Bleep test: 3 false turns
   before, 0 after.
4. **A text guard,** last: a turn heard while a line plays, whose words are 70%
   or more from lines just spoken, is dropped.

Acceptance claims for the build:

- C1. With speakers on and no one speaking, lines and system sounds produce no
  turn (bleep test and three-line replay, `scratchpad/aec-eval` in the trial).
- C2. Without loopback (other platforms), the player's samples are the
  reference, and C1 holds for the listener's own lines.

## S4. Noise and barge-in (W4)

- Speech is what Silero calls speech, not loudness: typing and a cough made no
  turn.
- Barge-in needs voice 10 dB over the floor, the canceller to have removed
  under 9 dB (so it is not echo), 1.5 s into a line, and 3 s of warm-up after
  start.
- Open: a short "mm-hmm" still cuts a line, since barge-in acts on sound
  before words.

## S5. Microphone (W3)

The saved mic is matched by id, then by name; if gone, the first mic that is
not a loopback is opened, and a `mic-fallback "<name>"` line says which, before
`ready`.

## S6. Acknowledgement (W5, W6, W7)

- Spoken cue lines in the voice model, and chimes, both sounded wrong (W5).
- **The listener itself** says a spinner word the moment a turn is
  transcribed (W7), never the same twice running: Combobulating, One sec,
  Looking into it, Percolating, Noodling on it, Pondering, Clauding,
  Julienning, Let me see, On it (W6). Recorded once at warm-up. Not counted as
  a play, so a say-back's play count is 1.
- The session speaks no acknowledgement of its own.

## S7. End of turn (W9)

- 2.5 s of silence ends a turn. A pause mid-thought did too, and the session
  answered half a sentence.
- Pipecat Smart Turn v3.2 (BSD-2-Clause, 8.7 MB int8 ONNX, Whisper Tiny
  encoder, last 8 s of 16 kHz audio) is asked when a turn ends; under 0.5, the
  turn is held while quiet lasts under 2.5 s more, the next turn joins it, at
  most 3 joins. It never ends a turn sooner. 15 ms per check on CPU.
- On 80 of the owner's captures it called 55 of 77 finished turns finished,
  and abrupt cuts were not told apart well; abrupt cuts are not real pauses.
  Live, a "wait, let me see" pause came through as one turn.
- Open: Whisper features are computed in numpy, checked against the formula
  but not against `transformers`; a mismatch could cost accuracy.

## S8. Say-back rules learned

- Echo and system sounds produced `interrupted` and odd turns that voided
  spoken yeses; S3 removed the cause.
- **The "but" rule** (a yes with "but" in it did not count) was too strict
  (W10): "But yeah, go for it" was a clear yes. Dropped in the prototype; no, not,
  don't, wait, stop, instead and actually stay.

## S9. Runtime and downloads

All under `~/.grimoire/incantation-sherpa-runtime/`, each with the owner's yes:
sherpa models and node package, Phonon venv, `aec-venv` (livekit 1.3.0,
onnxruntime 1.32.0), `vad/silero_vad.onnx`, `smart-turn/smart-turn-v3.2-cpu.onnx`
(Hugging Face pipecat-ai/smart-turn-v3 at f766f81d, sha256 2bb02631...).

## S10. Not tested

The owner's usual mic; NVIDIA Broadcast with noise removal on; a switch of
output device mid-session (loopback follows the default at start only);
macOS and Linux.

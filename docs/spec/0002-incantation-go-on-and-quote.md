# Incantation: go on after an easily undone say-back, and quote spoken lines

A draft. Two small changes to the incantation skill's text, built together
because both touch the same rules. No script changes.

## S1. The owner's words

By voice, 2026-11-26, in a head-chef lead's chat:

> I had another issue in the backlog about incantation where I asked you to
> not always confirm easily reversible actions. For example, filing the issue
> you just asked me about.

> And I don't want to completely skip the sayback. When it's easily
> reversible, you simply continue and not wait for a confirmation after the
> sayback.

By voice, 2026-11-25, in another session, on how spoken lines show in chat,
after the session showed a block quote:

> Yeah, exactly, exactly what you have displayed in the chat too right now is
> perfect.

And later in that session:

> I only want to see what you are saying. What I'm saying is already
> displayed to me in my own side.

## S2. What happens now

- **S2.1.** Every change is said back in one sentence, and the session acts
  only on a clear yes. A say-back ends the turn, so even an act that is trivial
  to undo, such as filing an issue or sending a member a message, waits for the
  person to answer.
- **S2.2.** Each spoken line is written in chat "word for word", with no
  format, so it reads like any other sentence.
- **S2.3.** The skill tells the session to show each `Heard: "…"` line of a
  delivery in chat. The relay already shows each relayed turn as the person's
  own message, so the reply repeats it.

## S3. The change: two kinds of say-back

- **S3.1. Every change is still said back.** The person hears what is about to
  happen. What changes is only whether the session waits for a yes. For an act
  that goes on, the person can stop it while the say-back plays; after that,
  cutting in mostly means putting it back (S3.4).
- **S3.2. Easily undone.** An act is easily undone when all four hold:
  1. the session can put it back itself, right after, in one step: close an
     issue it filed, restore a comment or a scratch file, set a card back, or
     send a correction to a session it messaged;
  2. it costs nothing: no money, no paid run, no usage beyond the turn;
  3. it reaches no one beyond the person's own tracker, their own sessions or
     the session's own scratch files, and the record is not public (in doubt,
     it is public);
  4. no rule the session runs under keeps it for the person's own
     confirmation, whether the person's, the session's configuration's or a
     repository's.

  A message to another session goes on only when it asks that session for
  nothing that would wait under these tests; one that asks it to change
  anything waits. An issue goes on only without a label that hands it to an
  agent. "The person's own tracker" includes the teammates and integrations it
  already notifies (the session's pick, S7).

  Examples: filing or editing an issue or a comment in the person's own,
  non-public tracker, sending a message to another of the person's sessions,
  editing a scratch file, changing a roster or status card. Putting a message
  back means sending a correction; what the other session already did stays
  under its own rules. Not easily undone: an issue or a comment on a public
  record, an edit to a repository file, a commit, a push, a merge, a delete, an
  install, a settings change, a start that spends usage, anything with a cost.
  Closing an issue the session itself just filed, as its put-back, is not "a
  delete". When the session is unsure, the act is not easily undone.
- **S3.3. Going on.** The steps for an easily undone act:
  1. the say-back says what the session is doing now ("I'll file that as a new
     issue now."), asks nothing, and is not the turn's last tool call;
  2. `listen.mjs idle`, so the line finishes playing before anything happens;
  3. `listen.mjs working` as its own call, its result read (a turn heard by
     then rides on it), then the act;
  4. `listen.mjs idle`, then the report, as for any request.

  The act waits instead, as one that is not easily undone, whenever the
  person may not have heard the say-back: the `say` answered anything but
  `speaking`; `idle` answered `idle-timeout`; or the session's voice is muted,
  since the person then only reads it. While the voice is muted, give the
  say-back that asks from the start. When the going-on line did not play or
  `idle` timed out, write in chat that the act is waiting, give the say-back
  that asks for a yes, and end the turn; that say is exempt from "make no say
  straight after another".
- **S3.4. Cutting in.** A turn aimed at the session that arrives after an
  easily undone say-back and before the act is done rides on a tool result.
  - A yes or a backchannel alone lets the act go on. (This does not make a
    mid-turn yes a clear yes: there is no question to confirm, and the act
    needed none.)
  - Room talk, a turn not aimed at the session, neither halts the act nor gets
    an answer (S4.6).
  - A turn whose aim is unclear, under "Is it for me?", halts it: the act then
    waits for a clear yes.
  - Any other turn halts it before the next tool call: do not act, or stop
    acting, read the turn and answer it. When part of the act was already done,
    say so and offer to put it back.
  - A turn that cut the say-back off (`interrupted`) means the person did not
    hear it whole: when the turn is neither a yes nor a halt, say the
    say-back again, and go on after it plays.
  - A heard "stop" said alone still ends voice mode, as the Stops say; a heard
    "wait" alone still halts and asks.

  For an act of one tool call, such as filing an issue, a turn the person
  starts after the say-back ends usually lands after the act: the turn closes
  on a pause, is transcribed, and rides on the act's own result. Cutting in
  then means putting it back (S3.5). This is accepted (S7).
- **S3.5. After it is done.** A later "undo that" or "no, take it back" is a
  new request; putting the act back as S3.2 test 1 names it is itself easily
  undone.
- **S3.6. Mixed requests.** When one request holds an easily undone act and
  one that waits, the whole request waits: say it back, end the turn, and act
  only on a clear yes.
- **S3.7. Unchanged.** Every act that is not easily undone keeps the say-back
  that asks for a yes, ends the turn and waits for a clear yes. All the clear
  yes rules, the Stops, the never-speak list and "voice replaces the typing
  only" stay as they are. A rule a session runs under still decides which acts
  wait for the person: the skill never loosens one. (`SKILL.md` names no
  particular skill or configuration here; its tests forbid it.)
- **S3.8. After a line that asks something.** The rule "after a line that
  asks the person something, speak nothing unasked until a turn arrives"
  does not apply to an easily undone say-back, which asks nothing.

## S4. The change: spoken lines in chat

- **S4.1.** Each spoken line goes to chat as a Markdown block quote, word for
  word as spoken: the greeting, say-backs, answers, reports and progress lines.
- **S4.2.** Text that is only for chat (an id, a link, a path, detail) goes
  outside the quote, so the quote holds the spoken words and nothing else.
- **S4.3.** The session no longer repeats a relayed `Heard` line in chat: the
  relay already shows it as the person's message.
- **S4.4.** A turn heard while the session works rides on a tool result as
  context, which the person does not see in chat. The session shows that one
  turn's words in chat once, outside any quote, as one plain line such as `Heard while working: "hold on"`. (The
  session's own pick: the owner's ask named only the relayed
  bubble. The relay's mid-turn path, in `brigade/voice-relay.ts`, adds the
  turn to the tool result's context and sends no chat message for it.)
- **S4.5.** When the session read a heard turn differently from its words,
  such as a mis-hearing it corrected, it says how it read it, in chat.
- **S4.6.** Talk not aimed at the session gets no answer: no speech, no
  say-back, no act, and nothing in chat beyond S4.4.

## S4a. The change: a head chef files an issue without waiting

The owner's example act was filing an issue in a head-chef lead's chat. Asked
whether to widen this change to head-chef's own rule, the owner, by voice,
relayed by the lead on 2026-11-26:

> It can be easily folded in here. It's all within Grimoire, right? I would
> fold it in, please.

- **S4a.1.** Head-chef's "A heard yes" paragraph today has the lead say every
  act back and end its turn on the say-back. One exception joins it: filing an
  issue the owner asked for, in the project's tracker, when the record is not
  public. The lead says it back, naming the tracker, and files it in the same
  turn, with no wait for a yes, only after a say-back the owner heard whole
  (not while the voice is muted, not when the say-back did not play or was cut
  off), and without a label that hands it to an agent. A heard turn aimed at
  the lead before it is filed, other than a yes or a backchannel alone, halts
  it, and the lead answers that turn; room talk does not halt it and gets no
  answer. After filing, the report names the issue, so the owner can ask for it
  closed.
- **S4a.1b.** The heard request, said back and gone on with, counts as the
  owner's words for that one filing: head-chef's "The owner's words" term and
  the filing row of its actions table say so, so the post is not marked as the
  lead's own pick.
- **S4a.2.** A filing on a public record, or one the lead is unsure is not
  public, still waits for a clear yes, since a
  public filing reaches people outside the owner's space and cannot be taken
  back unseen. (The session's own pick: the owner's words named issue filing,
  not its visibility.)
- **S4a.3.** Every other act in head-chef's actions table is unchanged. A
  typed ask was already the owner's confirmation naming the act, so nothing
  changes for typing.
- **S4a.4.** Head-chef's contract is amended in its schedule "Actions that need
  the owner's yes" first and copied to `SKILL.md` word for word, version
  2.13.0, *Proposed*, with a change-log row.
- **S4a.5.** With this, incantation's test 4 of S3.2 no longer holds the
  filing back in a lead: head-chef's own rule now lets it go on.

## S5. Files

- `skills/incantation/references/CONTRACT.md`: amended first, version 0.3.0.
- `skills/incantation/references/contract.changelog.md`: one row per change.
- `skills/incantation/SKILL.md`: regenerated from the contract.
- `skills/incantation/README.md`: the session example and the say-back bullet.
- `skills/head-chef/references/CONTRACT.md` (the schedule "Actions that need
  the owner's yes"), `skills/head-chef/SKILL.md` (the same section, word for
  word) and `skills/head-chef/references/contract.changelog.md`.
- `docs/security/threat-model.md`: the residual "Ambient speech steers a
  session" (S7).
- `docs/spec/incantation.md`: a note on its T6 decision ("A request that
  changes anything keeps the say-back and a yes") that this spec supersedes it
  for easily undone acts.
- `tests/incantation-skill.test.mjs`: the claims below.
- `.claude-plugin/plugin.json`: the minor version bumped.
- `docs/spec/README.md`: this spec's line.

**Terms, rows and assertions amended,** each with its mark in the contract:

| Where | What changes | Mark |
|---|---|---|
| incantation `roles` | "saying each request … asking for a yes or a no, and acting on a clear yes" gains the going-on case; "room talk gets only its Heard line in chat" becomes "room talk gets no answer" | **Decided** (S1) |
| incantation `tools`, Actions | the "make any change" row splits: easily undone acts go on after the say-back; the rest keep the wait | **Decided** (S1) |
| incantation `rules` | new rows for S3.2 to S3.4; "A request goes: … it ends the turn" scoped to acts that wait; "Every line it speaks is also in chat, word for word" gains the block quote; "Talk not aimed at the session gets only its Heard line" reworded | **Decided** (S1) for going on and the quote; *Proposed* for the four tests' exact wording, S3.3's wait cases, S3.4's sub-cases and S4.4 |
| incantation `writing` | "say-back" (**Confirmed**) drops "asking for a yes or a no" for the going-on kind; new term "easily undone" | *Proposed* |
| incantation `open` | the heard-yes safety row also counts an act done on going on that the owner disowns | *Proposed* |
| `tests/incantation-skill.test.mjs` | the "A say-back ends the turn" and "the `say` … is your turn's last tool call" assertions name acts that wait; the GRIM-65 "word for word" assertions gain the block quote; no old assertion is deleted without a replacement | — |
| head-chef schedules "Words" ("The owner's words") and "Actions that need the owner's yes" (the filing row and "A heard yes") | S4a.1, S4a.1b and S4a.2 | *Proposed* (head-chef's rule for a reworded clause) |
| incantation `SKILL.md` Hearing, the `interrupted` notice and "Each delivery" | S3.4's cut-off say-back is said again; S4.3 to S4.5 | procedure, named in the change log |
| `docs/security/threat-model.md` | the residual's prose; the score `Ambient speech: [0.40, 0.60]` is kept | — |

## S6. Acceptance claims

Each claim holds in both `SKILL.md` and `CONTRACT.md` unless it says otherwise.

- **C1.** "Easily undone" is defined by the four tests of S3.2, with at least
  the four examples, and says that in doubt an act is not easily undone.
- **C2.** For an easily undone act, the say-back asks nothing, the session runs
  `listen.mjs idle` after it, then `working`, and acts in the same turn; the
  act waits instead when the say did not answer `speaking`, `idle` timed out,
  or the voice is muted (S3.3).
- **C3.** A turn aimed at the session heard before an easily undone act is
  done halts it unless it is a backchannel or a yes alone; room talk neither
  halts nor gets an answer; an unclear aim halts and waits; a cut-off say-back
  is said again; a part already done is said and offered back (S3.4).
- **C4.** "A say-back ends the turn" now names only acts that wait, and the
  mixed request waits (S3.6, S3.7).
- **C5.** An act a rule of the session keeps for the person is never easily
  undone (S3.2 test 4).
- **C6.** Each spoken line is written in chat as a block quote, with chat-only
  text outside it (S4.1, S4.2).
- **C7.** `SKILL.md` no longer tells the session to show each relayed `Heard`
  line; it shows a turn heard while working once, and a corrected reading
  (S4.3 to S4.5).
- **C8.** Room talk gets no answer, and no rule left says it "gets only its
  Heard line" (S4.6).
- **C9.** The README's example and bullets match: a say-back for an easily
  undone act goes on, one for a change that waits still asks.
- **C10.** Head-chef's "A heard yes" paragraph, in `SKILL.md` and its
  contract schedule word for word, lets a non-public issue filing the owner
  asked for go on after a say-back heard whole, halts it on any other turn
  aimed at the lead, gives room talk no answer, counts the heard request as
  the owner's words for that filing, and keeps every other act's wait (S4a).
- **C11.** A message to another session goes on only when it asks for nothing
  that would wait (S3.2).

## S7. Trade-offs

- **Speed against a wrong act.** Going on saves the person a turn on most
  acts; the price is that a mis-heard request can file or send something
  before the person cuts in. The side taken: speed, for acts that pass all
  four tests only, since each is put back in one step and reaches no one
  outside the person's own space. Driver: the owner's words in S1.
- **Cutting in becomes undoing.** For a one-step act the say-back leaves
  almost no time to stop it first (S3.4). The side taken: undo after, since
  each such act is put back in one step. A real listen window before acting
  would need listener code and is not in this change.
- **Ambient speech: the risk is wider.** Until now another voice near the mic
  needed two heard turns to act, a request and a yes. After this change, one
  heard request is enough for an act that passes S3.2's four tests: no yes is
  asked, so none is needed. The threat model's accepted residual "Ambient
  speech steers a session" is amended to say so, and that residual is the
  owner's to accept. **Accepted by the owner, 2026-11-26,** by voice, relayed
  by the lead, to "accept the wider residual, with no security pair?": "Yeah,
  except that no security pair." No security pair runs on this change. The
  public-record exclusion (S3.2 test 3, S4a.2) keeps
  heard words off any public record without a yes, and a turn whose aim is
  unclear waits (S3.4). The contract's open row on whether a heard yes is safe
  enough also counts an act done on going on that the owner disowns, which
  restarts its clock.
- **Who a filing reaches.** A non-public tracker can still notify teammates
  and integrations, and closing an issue does not recall that. The side taken:
  those are inside "the person's own tracker", since the owner's own example
  was filing in such a workspace. Driver: S1. The owner can narrow it.

## S7a. Run it

- **Where it runs:** a Claude Code session with the grimoire plugin and its
  Brigade mod loaded and the listener running, after a plugin update and a
  restart.
- **The check:** `athanor run check` (AGENTS.md), or `node scripts/check.mjs`
  on the host where athanor is missing.
- **A live trial, offered to the owner at Test,** in a session that is not a
  lead: ask by voice to file a scratch issue in a private tracker and let it
  go on; then ask again and say "no" while the say-back plays. Pass: the first
  is filed and reported, the second halts or is offered back, spoken lines
  show as block quotes, and no relayed `Heard` line is repeated. It needs the
  owner's time, a few minutes; text-only claims cannot show the timing. Close
  the scratch issues after the trial.
- **Rollback:** revert the pull request, update the plugin and restart.
- **Stop line:** an act done on going on for a turn the owner did not say.
  Put it back, note it in the practice record, and bring the revert to the
  owner.

## S8. Not in this change

- The broader silent read-back for every checkpoint (act unless a stop word
  follows), an earlier backlog item. This change takes only its easily undone
  part.
- Head-chef's other tracker acts (an edit, a comment, a label, a close): they
  keep their wait. Only filing changes (S4a).
- Any listener or relay code.

# Specs

This folder holds the repo's specs in force, one file each. A new spec is `<NNNN>-<slug>.md`: `NNNN` is four digits, the highest numbered one in the folder plus one, from `0001`; `slug` is lower-case letters, digits and hyphens. The older one, `groundtrack.md`, keeps its name. Whether a spec is in force is decided by the owner's rule, the-pact's `claude/tracker.md` ("Specs in the tree"), installed as `~/.claude/tracker.md`, not by this file. Every file here is public, so a spec holds nothing a public record may not: no secret, personal detail, open security reason, weakness in others' software that is not yet public, or Linear id beyond a team key.

To add a spec: write the file, put its line at the top of "All specs" (and delete `None yet.` there if it is the first), and change nothing else. A line is one of:

- `- [<stem>](<stem>.md) — <one-line summary>`, `<stem>` being the file name without `.md`;
- `- history: [#<n>](<issue URL>) — <one-line summary>`, for a spec still on an issue; it names no file.

## Read these first

None yet.

## All specs

- [0006-brigade-quiet-members](0006-brigade-quiet-members.md) — a draft: the Brigade mod notes a member that goes idle or stops with no report, so the lead subscribes to no idle notice
- [0004-tests-faster](0004-tests-faster.md) — a draft: the test suite starts fewer processes, copies less and waits on states instead of fixed sleeps, with no shipped file changed
- [0003-incantation-retire-voicebox-and-kokoro](0003-incantation-retire-voicebox-and-kokoro.md) — a draft: retires Voicebox and Kokoro so Parakeet hears and Phonon speaks on one uv-required local runtime
- [0002-incantation-go-on-and-quote](0002-incantation-go-on-and-quote.md) — a draft: an easily undone act is said back and done with no yes, a head chef files a private issue the same way, and spoken lines show as block quotes
- [0001-incantation-from-the-prototype](0001-incantation-from-the-prototype.md) — a draft: the incantation skill gains the local sherpa engine, the echo stack, the relay and a clear spoken yes
- [groundtrack](groundtrack.md) — the skill that draws a plan or a piece of work as a call graph with traces

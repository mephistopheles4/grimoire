# The hiring interview

This page is part of the threat model in [`threat-model.md`](threat-model.md). A control it names is named by the threat model, and a security review is handed it with the threat model.

## The hiring interview, its data and its limits

The contract skill's second way in (#343, #344) renders a local page from a
draft, keeps the person's answers in the browser, and reads back the one
block the person pastes. What it holds, where, and for how long:

| Data | Where it sits | Who can read it | How long | What limits it |
| --- | --- | --- | --- | --- |
| Saved answers, and the light or dark choice | The browser's storage for pages opened from disk, under `contract-interview:<type>:<name>:<hash>` and `aviation-scheme`, unencrypted | Other pages opened from disk in the same browser, which can also write it; extensions with file access; programs running as the person; backups of the browser profile | Until the person presses Reset, which removes every key under the contract's prefix and leaves the light or dark choice; Reset holds what it cleared in the page's memory for ten seconds from the press, and Undo, offered only once the pointer or the focus has left the button and come back, writes it back; the browser may keep its own copy on disk for a while after | Reset, asked for at every hand-back; a restored answer or edit is marked, stays marked while it is typed in or its chip, skip or flag is tapped, goes to push-back, and is kept only by its own Keep; the published example (`--site`) keeps no answers, only the light or dark choice |
| The draft, the page and the answers file | The scratch folder, `contract-interview-` and 16 hex digits: in the per-user temp folder on Windows and macOS, under the account's cache folder on Linux, or in a parent the person names, unencrypted | The person's account; on Windows, whoever the temp folder's own access lets in; the readers of a folder the person names, and its sync | Until `--clean` deletes the page and the answers file at the hand-back, and the draft on the person's yes | The folder is mode 700 and the files mode 600 on macOS and Linux; the page is mode 600 wherever it lands unless `--site`, and owner-only before it holds the draft; a parent inside a git work tree is refused |
| The page's title and location | The browser's history | The person's profile, and their browser account if history syncs | As the browser keeps history | The page's notice says so |
| The PR records of claims 15 and 16 | The pull request, public | Anyone | As the repository keeps them | They name no one, hold no contact detail and no absolute path; claim 15 ran on head-chef's public contract |

**Two data migrations.** A redraft carries the person's saved answers from
the old draft's key to the new one, reading only the key the draft's
`previous` names, and on a page rendered with `--shared` it adopts nothing
when `previous` names another stored contract. A rewrite of an older-shape
contract copies every row of the old change log word for word into the new
change-log file, shows the change list before any write, and deletes the old
root contract in the same commit (claim 23 on #313).

**The limits.** Set by ADR 0004's method against the contract skill's own
contract, drafted fresh as `docs/limits/contract-skill.measured.json`
(SHA-256 `9faf6d8bca75bd599f62e92906eec45c6288fd550d421ddeab920a006866032b`):
each is four times that draft's figure, with no field limit under 4,000.
A draft or block over 387,512 bytes, a part of more than 152 clauses, or a
field longer than 6,844 characters is refused, naming the limit. A second
question on one clause is refused, so questions are bounded by clauses. The
page rendered from that draft measured 381,464 bytes on 2026-10-18, and a
test holds it within four times that, 1,525,856 bytes.

Accepted risk: class K2 (E73a, E73b), in the threat model. Candidate P1 (E73c), in the threat model. The interview's
saved answers sit unencrypted in the browser profile, where other pages
opened from disk in the same browser, extensions with file access, processes
running as the person and profile backups can read them. The scratch
folder's draft (the exemplar, the proposals and the answers taken into it),
page and answers file hold the same work unencrypted until they are deleted.
Accepted risk: class K2 (E73a, E73b), in the threat model. Candidate P1 (E73c), in the threat model. Reset removes the saved answers from
the page's store, though the browser may keep its own copy on disk for a
while; the hand-back deletes the page and the answers file and offers to
delete the draft; the folder is owner-only on macOS and Linux, and on
Windows rests on the per-user temp folder's own access; a folder the person
names instead is as private as that folder, and its files leave the machine
if it syncs.

Candidate P3 (E74), in the threat model. Its
data was head-chef's public contract, so nothing it served was private.

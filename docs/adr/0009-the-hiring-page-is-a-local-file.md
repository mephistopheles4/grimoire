# The hiring page is a local file, and keeps answers unencrypted

From 0.13.0 the contract skill has a second way in. The person answers by
picking on a page the skill renders, then pastes one answer block back into
chat. The owner chose its shape on issue 313; this records the three choices
a later reader would most want to undo, and why they stand.

## A local file, not an Artifact

The page is one self-contained HTML file that the interview script writes
into a scratch folder on the person's machine, and the person opens it in
their own browser (q2). It is not a hosted Artifact, and it is never
published. A hosted page would be easier to open and could keep its own
store, but it would put the person's draft on a service, need an account,
and tie the skill to one product. The local file runs wherever Node 24 runs
and loads nothing from the network: its fonts and its stylesheet are inside
it, and a content security policy holds that. The cost is a copy and paste
back into chat, and a page some setups cannot open, such as a remote
session; the skill then offers the chat way.

## Answers kept, and kept unencrypted

The page keeps the person's answers in the browser's local storage, so a
closed page restores them (q8). The skill's own rule, "nothing records
anything by default", names this store as its one exception. Forget removes
the answers from the page's store; the browser may keep its own copy on disk
for a while. The draft, the page and the answers file in the scratch folder hold the
same answers until the hand-back deletes them (q17, q18). None of this is
encrypted (q10, q17). A key the page could hold would sit beside the data it
protects, so encryption would add code and no real protection against the
readers that matter: other pages opened from disk in the same browser,
extensions with file access, programs running as the person, and profile
backups. The owner accepted that risk to keep the page simple; the threat
model records it as an accepted risk, with its date and source. What limits
it is Forget, the deletes at the hand-back, and a scratch folder only the
person's account can open on macOS and Linux.

## SHA-256 binds a block to its draft, and proves nothing more

The page carries the SHA-256 of the draft it was made from and of the kinds
table, and the answer block repeats both. The script refuses a block whose
hashes differ from the draft and the kinds table in front of it. That catches
a block pasted against the wrong draft, or a page made before the skill
changed. It is not a signature: anyone can compute the same hashes, so they
say nothing about who made a block. What the block says is checked field by
field, printed back by the script rather than retold, and every term that
can do damage goes back to the person in chat, in their own words.

## What would change this

A hosted page becomes worth it if the copy and paste turns out to be where
people stall, in the field tests that rebuild head-chef and eagle-eye through
the page. Encryption becomes worth it if the page ever holds something a
local reader should not see even when the person is the only user of the
machine.

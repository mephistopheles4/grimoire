# Writing a trace

A trace is a list of moves you write by hand. [`flightpath-file.md`](flightpath-file.md)
holds the shape. The validator's refusals say what is wrong. This page holds
what no refusal can tell you.

## Contents

- Follow the code, not the diagram
- A failure is one move
- A handler the program has not got
- Provenance
- What a good trace shows

## Follow the code, not the diagram

Open the material and follow one route through it, move by move. Write the move
as you pass it. A trace written from a remembered shape drifts at the first
branch. The drift stays silent until a `next` lands somewhere the step cannot
reach, often four moves later.

Write the graph, validate, and only then write the first trace.

## A failure is one move

An effect that failed carries `raised` and no `next`. No second move
follows to throw it. If you catch yourself writing two moves for one failure,
the shape has already told you it only wants one.

Then decide which kind of failure it is:

- **The effect throws.** The effect move carries `raised`. A `propagate`
  follows for each frame the error leaves. Then comes either an `uncaught`, or
  a `catch` in a frame whose call step declares that tag. Before an
  `uncaught`, the `propagate` moves are optional. The `uncaught` pops every
  frame still open, and the error path records each one.
- **The effect returns a failure value the code inspects.** The effect move
  carries `next` to the `if` that inspects it, and the `if` routes to the
  `throw` step.

Both are ordinary. Pick the one the real code does.

**Give the error its cause.** Write `fail` for an error the node's `error`
list names. Write `die` for a defect the list does not name. Every `throw` move
and the `uncaught` move repeat the cause the error carries.

## A handler the program has not got

The validator cannot see this one. A declared but unused `onError` is a legal
path, so a file can be green and describe a program that does not exist. Before
you call the file done:

- Read every `onError` you wrote, and find the line in the material that
  catches that tag. If there is none, delete the handler.
- Read every `error` list, and find what throws each tag.
- Read every `role`, and check the node does what the word says. Mark a node
  that writes an argument in place `mutates`, not `pure`.

## Provenance

`authored` means a person or an agent wrote this trace from reading the
material. `captured` means a real run produced it. **Write `authored` unless a
run produced it.** The page stamps the two differently, because an authored
trace is a longer claim and not a check. No recorder ships, so every trace you
write is `authored`.

## What a good trace shows

One route, chosen because it shows something. A file with five runs that all
take the happy path is a file whose run picker changes nothing. Give each run a
`blurb` of one sentence saying what it shows. A reader chooses between runs on
that sentence alone.

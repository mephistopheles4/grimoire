---
type: llm
weight: 1
---

Grade the trace (the groundtrack file and its page) the agent produced, against the reference example for this input and the rules below. The reference is `skills/groundtrack/examples/greet.flightpath.json` on main. It is a model of a good answer, not the only one: a differently named node that does the same job counts.

1. **Callers.** Every node except the entry names its caller: a call step in another node reaches it. No node floats unattached, and no call is invented that the material does not make.
2. **What each step hands back.** Each node's `success` channel says what flows out, and each trace move that returns, binds or hands a value back says what it is.
3. **Where it breaks.** Each node's `error` list names the tags it can throw as a fail, and a die never appears in that list. At least one run shows a failure: the throw, the frames it leaves, and the catch or the uncaught. Every `onError` has a matching catch in the material, and no handler is invented.
4. **Requirements.** Each node lists what it needs to work (a store, a gate, an artifact), as the material states.
5. **Honesty.** The scope rule and any graph not drawn are stated in `sheet`. Provenance is `authored`. The file says where it goes past the material (an invented run, an assumed handler) in a `blurb` or `aside`. You are given the files only, not the agent's closing message, so do not mark its absence down.
6. **Findings.** Every finding `--check` printed is answered (fixed, or kept with one line of reason) and shown to the reader.

Score each point 0 to 2 and give a total out of 12. If the output cannot be judged, say unknown in your reason.

Input-specific: the reference has two nodes, `greet` (handler) and `lookupName` (io). `lookupName` throws `NoSuchUser` as a fail and `greet` catches it and falls back to the plain hello. `greet`'s error list names `SendFailed`. A test layer swaps the name store for a fixed map and renames a token, not a node.

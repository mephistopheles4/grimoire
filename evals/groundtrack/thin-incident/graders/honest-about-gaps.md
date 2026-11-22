---
type: llm
focus: { source: file, path: trace/webhook.flightpath.json }
---

The file is a groundtrack graph drawn from a short incident note that leaves much unknown. Judge whether it draws what the note states and is honest about the rest.

What the note states: the route checks the signature, enqueues the event on `payments` and answers 200; the worker `applyPayment` finds the invoice, marks it paid and emails a receipt; some events were applied twice although the provider sent them once.

What the note does not state, and a good file must not present as fact: what happens when the signature check fails; whether the queue redelivers an event (for example after a worker crash or a timeout); whether `applyPayment` checks for an event it has already applied; what happens when the invoice is not found or the email fails; the cause of the double payments.

PASS when the file draws the stated steps and effects, marks every unknown it draws (a guessed error, an assumed redelivery, a missing check) as a guess in a `blurb`, `aside` or `sheet` note, invents no handler the note does not name, and does not state a cause as found. FAIL when it presents any unknown above as fact, invents a handler or a cause, or leaves out a stated step.

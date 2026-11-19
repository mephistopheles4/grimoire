---
type: llm
weight: 1
---

Grade the box (the eagle-eye box file, its page and the agent's hand-back). There is no reference box for this input; judge against the person's text and the couplings below, which a careful reader of that text would find.

1. **Rows and options.** The five decisions the person named (transport, delivery guarantee, where workers run, retries and dead letters, observability) are rows, and every option the person listed is present. The person's budget and the 50-a-second sender limit appear as constraints on edges and not as made-up rows.
2. **Coupled decisions found.** The edges connect rows that really pull on each other. Credit each of these, and discount edges that connect rows that do not touch:
   - payment notices must never be sent twice, so at-least-once needs idempotent consumers, and exactly-once pulls on the transport;
   - `LISTEN/NOTIFY` does not keep a message for a listener that is down, so it needs the jobs table;
   - near-zero budget rules out new infrastructure such as a managed queue nobody has run, or a new dedicated VM;
   - 30-second reset emails pull against slow backoff or a manual "resend";
   - the 50-a-second sender limit pulls on serverless workers that scale out without a cap;
   - audit traceability pulls on observability (an order id on every notice);
   - one on-call person pulls against alerting on every retry.
3. **Ruled-out combinations say why.** Each conflict or requirement edge carries a one-line why that a reader can check, and says what it rests on (measured, sourced, or argued). No edge is bare, and no argued edge is dressed as measured or sourced.
4. **Strawmen.** Rows carry an option that tests the box (for example no retries at all, or logs only), and the hand-back says whether the chosen set rules each one out.
5. **Findings and the verdict.** The box answers what the renderer's findings would raise (most connected option, rows with no edges, strawmen not rejected, how much of the verdict rests on argued edges): a row with no edge says why it is free, and a strawman nothing rules out is either ruled out by an edge or noted. The person asked "which combinations actually hold": the preset or chosen set shows one that holds. Judge this from the box file and its `suspected`, `notes` and `presets`; where `handover.md` exists, read it too.
6. **Honesty.** Argued edges are labelled argued, and no edge claims a measurement or a source it does not have. You are given the files only (and `handover.md` where it exists), so do not mark a missing closing message down.

Score each point 0 to 2 and give a total out of 12. If the output cannot be judged, say unknown in your reason.

# groundtrack refuses a hostile file at three measured limits, and accepts the rest

A flightpath file is made to be shared, so groundtrack may render one a
stranger wrote. Row 5 of the [threat model](../security/threat-model.md) asks
whether such a file can stall or crash the renderer or the page on the
reader's machine. It rates that low likelihood and low impact: the worst case
is a frozen tab or command the reader can close.

`render.mjs` refuses a file at three limits, all checked before it reads a
run:

- **A graph more than 1,000 calls deep.** A deeper call structure could
  overflow the call stack of anything that walks it.
- **A tree view of more than 20,000 rows.** The tree draws one row per path
  from the entry, so a graph whose calls fan out and meet again draws
  exponentially more rows than it has nodes.
- **A search for cut calls that costs more than 1,000,000 units.** The unit is
  counted by `cutEdgesWork` in `groundtrack.js`: for each layer that renames
  anything, its renamed tokens times the sum of the argument characters and
  the call steps, summed over the layers. The same count bounds how many cuts
  there can be.

Each refusal names its limit. The cut budget's also names the file's count;
the other two stop counting at the limit, so they say "more than". Every
other cost that was measured is made to grow in step with the file rather
than capped. The numbers, the files that produced them and the machine are in
the threat model's "Row 5, measured".

The limits were sized against `docs/examples/pr-382.flightpath.json`, the
largest real sheet: it sits 71 times under the depth limit, 66 times under the
row limit and 12.9 times under the cut budget. The cut budget is the tightest,
so a much larger real sheet with many layers and long call arguments would
meet it first.

## When to stop

**Stop by the threat's rating, not when a reviewer runs out of findings.**
Four rounds of adversarial review each found another slow file that passed
every limit so far. A renderer with this many algorithms always has another
slow path, so "find a file that stalls it" always succeeds. The work stopped
when the next fix cost more than a low rating justifies, and what was left is
recorded in row 5 as accepted: two costs inside `fold`, which #147 would
remove.

A change that finds a new slow path should record it in row 5 and weigh it
against the rating before adding a limit.

## Considered Options

**Capping moves, nesting and total moves was rejected.** The cost they fenced
was `fold` copying every state, and a cap tight enough to bound it refused
real files first. Fixing `fold` instead removed the cost at its source; see
[0003](0003-fold-keeps-one-copy-of-a-walk.md).

**Capping node-id length was tried and removed.** Measurement showed cost
follows file size, not id length, and a 128-character cap stopped none of the
slow paths it was meant for.

**Fixing every slow path until review finds none was rejected.** It does not
converge, and each round added code a future reader has to understand.

## Consequences

A real file can be refused. The refusal says which limit and by how much, so
the fix is to split the change or raise the constant in `render.mjs` with a
measurement to back it. The page's own drawing is not held to the renderer's
time: a 20,000-box page takes about 6 s, nearly all of it the browser
building boxes. Code that runs only in the page has no automated test, so a
change there needs checking in a browser.

---
type: llm
focus: { source: file, path: trace/checkout.flightpath.json }
---

The file is a groundtrack call graph of `placeOrder`, written from the code in the prompt. Check it against these facts, which hold by construction. A different node name for the same function counts.

1. `placeOrder` calls `loadCart`, `reserveStock`, `withRetry`, `releaseStock` and `writeOrder`. `chargeCard` is reached only through the callback `placeOrder` hands to `withRetry`; the file shows that, and does not draw a direct call from `placeOrder` to `chargeCard`.
2. `CartNotFound` is a fail that `placeOrder` catches; it does not leave `placeOrder`.
3. `CardDeclined` is a fail that `placeOrder` catches, after releasing the stock hold.
4. `OutOfStock` is a fail that `placeOrder` does not catch, so it is in `placeOrder`'s error list.
5. `Timeout` is a fail that `withRetry` catches and retries; after the last try it leaves `withRetry`, and `placeOrder` rethrows it, so it is in `placeOrder`'s error list too.
6. The total mismatch is a defect (a die): it is never in any node's error list, and no handler is drawn for it.
7. The effects are the reads and writes the prompt names (the carts, stock and orders tables, the payment provider), and no others are invented.
8. One run places an order and one run fails, and the failing run shows where the error is thrown and where it is caught or leaves the graph.

PASS when every fact holds, or when at most one is missing and nothing in the file contradicts the code. FAIL when the file invents a call or a handler, lists the defect as an expected error, or misses two or more facts.

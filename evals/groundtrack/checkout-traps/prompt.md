---
max_turns: 40
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/groundtrack

Here is a small change to a shop's checkout. `placeOrder` is the one entry point. Draw its graph, with one run where the order goes through and one where it fails, validate it, and render the page. The working folder is your scratch folder: write the file as `trace/checkout.flightpath.json`, the page as `trace/checkout.html`, and save what `--text` prints for the failing run to `trace/tree.txt`.

`src/checkout.ts` (new):

```ts
import { loadCart, CartNotFound } from "./carts";
import { reserveStock, releaseStock } from "./stock";
import { chargeCard, CardDeclined } from "./payments";
import { withRetry } from "./retry";
import { writeOrder } from "./orders";

export class Defect extends Error {}

export async function placeOrder(cartId: string, card: string) {
  let cart;
  try {
    cart = await loadCart(cartId);
  } catch (e) {
    if (e instanceof CartNotFound) return { status: "empty" as const };
    throw e;
  }
  const total = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  if (total !== cart.total) throw new Defect("cart total out of step with its items");

  const hold = await reserveStock(cart.items); // OutOfStock is not caught here

  try {
    await withRetry(3, () => chargeCard(card, total));
  } catch (e) {
    await releaseStock(hold);
    if (e instanceof CardDeclined) return { status: "declined" as const };
    throw e;
  }

  const orderId = await writeOrder(cart, hold); // inserts one row in the orders table
  return { status: "placed" as const, orderId };
}
```

What the other modules do, from their own code (not shown):

- `loadCart(cartId)` reads the carts table and returns the cart, or throws `CartNotFound`.
- `reserveStock(items)` holds stock in the stock table and returns the hold, or throws `OutOfStock`.
- `releaseStock(hold)` deletes the hold. It does not throw.
- `withRetry(n, fn)` calls `fn` up to `n` times while it throws `Timeout`, then rethrows the last error. Any other error it rethrows at once.
- `chargeCard(card, amount)` calls the payment provider and returns a receipt, or throws `CardDeclined` or `Timeout`.
- `writeOrder(cart, hold)` inserts the order row and returns its id. It does not throw.

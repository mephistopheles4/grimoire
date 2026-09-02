# Eval task 2 — the cart total

Write one `flightpath.json` file for the program below.

## The program

`checkout(cartId)` turns a cart into an order.

1. It calls `loadCart(cartId)`, which performs a `db.get` effect and returns the
   cart. It throws `NoCart` on the `escape` channel when the row is missing.
2. It calls `priceCart(cart)`, a pure node. `priceCart` loops: it has a `goto`
   back to a labelled step while items remain, and an `if` that leaves the loop.
   It returns the total in pence.
3. If the total is zero, `checkout` jumps to a labelled `empty` step and returns
   `"nothing to buy"`.
4. Otherwise it calls `charge(total)`, which performs a `stripe.charge` effect.
   `charge` can fail with `CardDeclined` on the `retry` channel.
5. `checkout` handles `CardDeclined` by jumping to a `declined` step, which
   performs a `mail.send` effect telling the customer, then returns
   `"payment declined"`.
6. On success it returns the order id.

## Files in the change

- `src/checkout.ts` — edit, 62 added, 11 deleted, holds `checkout`
- `src/pricing.ts` — new, 38 added, 0 deleted, holds `priceCart`
- `src/cart-store.ts` — edit, 9 added, 1 deleted, holds `loadCart`
- `src/payments.ts` — edit, 27 added, 4 deleted, holds `charge`

`src/checkout.test.ts` has specs that call `checkout` and `loadCart`.
`src/pricing.test.ts` has specs that call `priceCart`.
No spec calls `charge`.

## Layers

Three: `production`; `tests`, where `charge`'s requirement `the Stripe client`
becomes `a stub that always declines · checkout.test.ts:44` and `loadCart`'s
requirement `the cart table` becomes `an in-memory map · checkout.test.ts:12`;
and `smoke`, which substitutes nothing and enters at `checkout`.

## Walks

Write **two** presets:

- **a paid order** — the cart loads, prices at 4500 pence, the charge succeeds.
- **the card declines** — the charge fails, `checkout` catches it, the mail goes
  out, and it returns `"payment declined"`.

The pricing loop must run at least twice in both walks.

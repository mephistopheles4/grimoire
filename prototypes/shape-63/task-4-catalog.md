# Eval task 4 — the price panel

New for this round. Nothing was tuned against it, and it is the only task with
two entry points.

Write one `flightpath.json` file for the change below.

## The change

One change to a shop, entered two ways. The server renders the catalogue page,
and the browser re-applies filters without a reload. Both paths format a price.

### `renderCatalog(pageId)` — the server render

1. It performs a `db.query` effect that loads the page's products. When the page
   is missing it throws `NoPage` on the `escape` channel.
2. It loops over the products: a labelled step at the top, an `if` that leaves
   the loop when none remain, and a `goto` back to the label.
3. Inside the loop it calls `formatPrice(pence)`, which returns the price as a
   display string.
4. When the loop ends it calls `renderGrid(rows)`, a pure node that returns the
   HTML for the grid.
5. It returns that HTML.

### `applyFilters(query)` — the browser re-filter

1. It calls `parseQuery(query)`, a pure node that returns the filter object and
   throws `BadQuery` on the `die` channel when the query will not parse.
2. It performs an `api.get` effect that fetches the matching products. That
   effect can fail with `Timeout` on the `retry` channel.
3. `applyFilters` handles `Timeout` by jumping to a labelled `stale` step, which
   keeps the rows already on the page and returns `"kept the stale rows"`.
4. On success it loops over the matches — a labelled step, an `if` that leaves
   the loop, a `goto` back — and calls `formatPrice(pence)` for each.
5. It performs a `dom.patch` effect that writes the rows into the page.
6. It returns the number of rows written.
7. `BadQuery` is **not** handled anywhere. It reaches the top uncaught.

### The node both paths reach

`formatPrice(pence)` is pure. It divides by a hundred, and returns a string
like `"£12.50"`. Both entry points reach it, and it is one node.

## Files in the change

- `src/catalog/render.ts` — edit, 47 added, 8 deleted, holds `renderCatalog`
- `src/catalog/grid.ts` — new, 31 added, 0 deleted, holds `renderGrid`
- `src/filters/apply.ts` — edit, 52 added, 15 deleted, holds `applyFilters`
- `src/filters/parse.ts` — new, 24 added, 0 deleted, holds `parseQuery`
- `src/money/format.ts` — new, 18 added, 0 deleted, holds `formatPrice`

`src/catalog/render.test.ts` has specs that call `renderCatalog`.
`src/filters/parse.test.ts` has specs that call `parseQuery`.
`src/money/format.test.ts` has specs that call `formatPrice`.
No spec calls `renderGrid` or `applyFilters`.

## Layers

Two: `production`; and `tests`, where `renderCatalog`'s requirement
`the products table` becomes `a seeded fixture · render.test.ts:14` and
`applyFilters`'s requirement `the search API` becomes
`a canned response · apply.test.ts:31`.

## The graphs

Two entry points, so two graphs:

- **the catalogue page**, entered at `renderCatalog`.
- **the filter panel**, entered at `applyFilters`.

## Walks

Write **three** presets in total.

On the catalogue page graph:

- **the happy path** — two products load, both prices format, the grid renders.

On the filter panel graph:

- **the happy path** — the query parses, the API returns two matches, both
  prices format, the DOM patch lands, and it returns 2.
- **a bad query** — `parseQuery` throws `BadQuery` and nothing catches it.

Both graphs have a run called *the happy path*, and that is deliberate.

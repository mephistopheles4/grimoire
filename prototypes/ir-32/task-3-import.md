# Eval task 3 — the CSV import

Held out. Neither the shape nor the worked example was tuned against this task.

Write one `flightpath.json` file for the program below.

## The program

`importContacts(uploadId)` loads a CSV of contacts into the address book.

1. It calls `fetchUpload(uploadId)`, which performs an `s3.get` effect and
   returns the raw bytes. It throws `NoUpload` on the `escape` channel when the
   object is missing.
2. It calls `parseRows(bytes)`, a pure node that returns a list of rows and
   throws `BadCsv` on the `die` channel when the header line is wrong.
3. It then loops over the rows. The loop has a labelled step at the top, an `if`
   that leaves the loop when no rows remain, and a `goto` back to the label.
4. Inside the loop it calls `saveContact(row)`, which performs a `db.insert`
   effect. `saveContact` can fail with `Duplicate` on the `retry` channel.
   `importContacts` handles `Duplicate` by jumping to a `skip` step inside the
   loop, which counts the row as skipped and continues.
5. `saveContact` also calls `normalise(row)` before it inserts. `normalise` is
   pure and returns the cleaned row. So production reaches `normalise` three
   calls deep: `importContacts` → `saveContact` → `normalise`.
6. When the loop ends, `importContacts` performs a `metrics.write` effect and
   returns a count of saved and skipped rows.
7. `BadCsv` is **not** handled anywhere. It reaches the top uncaught.

## Files in the change

- `src/import/contacts.ts` — edit, 88 added, 12 deleted, holds `importContacts`
- `src/import/parse.ts` — new, 41 added, 0 deleted, holds `parseRows`
- `src/import/fetch.ts` — new, 19 added, 0 deleted, holds `fetchUpload`
- `src/contacts/save.ts` — edit, 33 added, 7 deleted, holds `saveContact`
- `src/contacts/normalise.ts` — edit, 14 added, 2 deleted, holds `normalise`

`src/import/contacts.test.ts` has specs that call `importContacts` and
`parseRows`. `src/contacts/normalise.test.ts` has specs that call `normalise`.
No spec calls `fetchUpload` or `saveContact`.

## Layers

Two: `production`; and `tests`, where `fetchUpload`'s requirement `the S3
client` becomes `a fixture directory · contacts.test.ts:9` and `saveContact`'s
requirement `the contacts table` becomes `an in-memory list ·
contacts.test.ts:22`. The `tests` layer enters at `importContacts`.

## Walks

Write **three** presets:

- **two rows, one duplicate** — the loop runs twice, the first row saves, the
  second raises `Duplicate`, the handler skips it, and the import returns
  1 saved and 1 skipped.
- **a bad header** — `parseRows` throws `BadCsv` and nothing catches it.
- **no upload** — `fetchUpload`'s effect raises `NoUpload`, and nothing catches
  it either.

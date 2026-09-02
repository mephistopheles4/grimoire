# Eval task 1 — the retry

Write one `flightpath.json` file for the program below.

## The program

`publishPost(draftId)` publishes a blog post.

1. It reads the draft from the store. This is an effect, `db.get`.
2. If the draft is empty it throws `EmptyDraft` on the `escape` channel.
3. Otherwise it calls `renderHtml(draft)`, a pure node that returns the HTML
   string and can fail with `BadMarkdown`.
4. It then calls `uploadHtml(html)`, which performs an `s3.put` effect. That
   effect fails on the first attempt and succeeds on the second — a retry.
5. `publishPost` handles `BadMarkdown` by jumping to a `fallback` step that sets
   the HTML to a plain-text version, then continues to the upload.
6. It returns the published URL.

`renderHtml` is pure: it has no effects, one `if` for the empty-body case, and
throws `BadMarkdown` on the `die` channel when the markdown will not parse.

`uploadHtml` performs the `s3.put` effect and returns the URL.

## Files in the change

- `src/publish.ts` — edit, 40 added, 6 deleted, holds `publishPost`
- `src/render.ts` — new, 55 added, 0 deleted, holds `renderHtml`
- `src/upload.ts` — edit, 18 added, 2 deleted, holds `uploadHtml`

`src/publish.test.ts` has specs that call `publishPost` and `renderHtml`.
Nothing calls `uploadHtml` from a spec.

## Layers

Two: `production`, and `tests` where `uploadHtml`'s requirement `the S3 client`
is replaced by `a fake bucket · publish.test.ts:31`.

## Walks

Write **two** presets:

- **the happy path** — a real draft, the markdown renders, the upload succeeds
  on the second attempt.
- **bad markdown** — the render throws `BadMarkdown`, `publishPost` catches it,
  and the fallback HTML uploads.

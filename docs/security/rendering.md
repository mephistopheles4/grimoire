# How the pages handle a stranger's text

Both renderers turn a file somebody else may have written into an HTML page you
open. This is the main risk in the repository, so this page states exactly what
guards it and where that guard stops. [`SECURITY.md`](../../SECURITY.md) is the
summary.

## The escape, and why it is narrow on purpose

Both skills pair two guards.

- **Before the file's JSON goes into a `<script>` block, the renderer escapes
  `</`.** A string that contains `</script>` cannot close the block. See
  `skills/eagle-eye/render.mjs` and `skills/groundtrack/scripts/render.mjs`.
- **Before author text reaches `innerHTML`, the page escapes `&` and `<`, and
  not the double quote.** The function is `esc` in
  `skills/eagle-eye/lib/eagle-eye.js` and in
  `skills/groundtrack/scripts/groundtrack.js`. Each renderer inlines its module
  into the page, so the page and the tests run the same function.

The escape is enough only because **author text never reaches an HTML
attribute.** Every interpolated attribute holds an id, an index, a number, a
fixed class name, or a help string that carries no author text. Ids are
validated rather than escaped: eagle-eye accepts `^[a-z0-9][a-z0-9-]*$`,
groundtrack `^[A-Za-z0-9][A-Za-z0-9-]*$`.

One attribute on each page is built by the module rather than the template:

- **eagle-eye:** the tier name in `class="tier …"` on the *weakest edge*
  finding. The module reduces anything other than `measured`, `sourced` or
  `argued` to `argued` before writing it.
- **groundtrack:** the tour control's help string. The only thing it takes from
  the file is the number of stops.

eagle-eye's findings are built in the module, not the template, and go through
the same escape. The module lives apart from the markup that calls it for one
reason: a function inside the page template is a function no test can reach.

## Three rules for anyone changing a page

1. **Author text goes into element content, never into an attribute.**
2. **If an attribute must ever carry author text, the narrow escape does not
   cover it.** A URL wants percent-encoding, which is what
   `scripts/build-pages.mjs` uses for the one `href` it writes. Widening the
   shared escape to cover the double quote is a security change, and is
   reviewed as one. So is any new `="${` in a template.
3. **Nothing from a file is safe as an object key, ids included.** Use
   `Groundtrack.bare()` (`Object.create(null)`) for any map keyed by text from a
   flightpath file, and `Object.hasOwn` for a membership test.
   `Groundtrack.hardenKeys` rebuilds `nodes`, `env`, `layers`, a layer's
   `nodes` and a run's `input` without a prototype. The renderer and the page
   both call it before reading the file.

### Why rule 3 exists

"Ids are validated" is true, and it makes an id safe **in an attribute**. It
says nothing about keys. The id pattern admits `constructor`, `toString`,
`valueOf`, `hasOwnProperty` and `isPrototypeOf`. Labels, file paths, failure
tags, run names and layer tokens are not validated at all.

A plain `{}` inherits from `Object.prototype`, so a key nobody set still
answers. `t[k] || fallback` never falls back, and `t[k] === undefined` never
guards. Neither throws, so the damage shows up somewhere else.

The real example was a wrong diagnosis, not a crash. A `goto` naming a missing
label is refused as *"nowhere" is not a label*. Spell the same missing label
`constructor` and that check passes, and the file is refused for a missing edge
instead. The author is told their walk is wrong when their node is wrong.

The mistake recurred three times in one afternoon, once from someone who had
just read that ids were validated. That is why it is a rule and not only a fix.

## What the tests hold

- **The escape's width.** [`tests/esc.test.mjs`](../../tests/esc.test.mjs) and
  [`tests/groundtrack-fold.test.mjs`](../../tests/groundtrack-fold.test.mjs)
  assert that `&` and `<` are escaped **and** that the double quote passes
  through. Widening or narrowing the escape is then a visible test change.
- **The script block.** [`tests/render.test.mjs`](../../tests/render.test.mjs)
  renders a `why` carrying `</script><script>…</script>` and checks it closes
  no block.
  [`tests/groundtrack-render.test.mjs`](../../tests/groundtrack-render.test.mjs)
  puts `<`, `&`, a double quote and a closing script tag into **every**
  author-written field the page shows. A field left out of that fixture is a
  field with no coverage.
- **eagle-eye's findings.** One box carries `<img …>` in every row name, option
  name and `why`, fires every finding, and checks none of them writes the tag.
  This runs at the module, because the findings are built in the browser.
- **Prototype keys.** The two groundtrack test files use fixtures whose field
  **is** the bare name, such as `constructor`. A decorated name like
  `constructor.ts` is an ordinary key and tests nothing.
- **Attributes, partly.** `tests/groundtrack-render.test.mjs` fails if an
  `esc(...)` call appears inside an attribute value in groundtrack's template.

**What the tests do not cover.** They check the escape and the text it
produces, not every `innerHTML` call that consumes it. Proving "no author text
reaches an attribute" needs a parse of the rendered page, and nothing here does
that. A reviewer still holds that claim.

## The pages make no network request

Every page, and the site index, is self-contained and loads nothing on its own.
The three IBM Plex Mono faces are vendored, unmodified, under the SIL Open Font
Licence, and inlined as `data:` URIs. Each skill carries its own copy; see
`skills/eagle-eye/assets/FONTS.md` and `skills/groundtrack/assets/FONTS.md`.

The pages used to link a Google Fonts stylesheet, which told Google each time a
page was opened. That is gone.

`tests/render.test.mjs`, `tests/groundtrack-render.test.mjs` and
`tests/build-pages.test.mjs` each assert **zero** external references. They
check `src` and `href` anywhere, CSS `@import` and `url()`, `fetch`,
`XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon`. A link the reader
clicks is not a request the page makes: the index carries one to GitHub, named
in the test rather than exempted by a wildcard.

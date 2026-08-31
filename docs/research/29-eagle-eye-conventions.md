# What conventions must a sibling of eagle-eye match?

Research for [#29](https://github.com/mephistopheles4/grimoire/issues/29), under
map [#25](https://github.com/mephistopheles4/grimoire/issues/25).

**Read at `aabebed2` (`origin/main`, "Show the brief in the findings list (#24)"),
plugin version `0.6.0`.** Every line number below is that commit. Nothing in this
repository holds a line number to its file, so re-pin them before quoting them
later — `SECURITY.md` carries six such citations and they were last re-pinned by
hand in the commit that moved them.

There is no `docs/research/` in this tree. `docs/agents/` holds standing guidance
and `docs/decisions/` holds kept box files, and this is neither, so it lands in a
new folder named for what it is.

**This file reports obligations, not behaviour.** Where a convention looks like an
accident rather than a decision, it is labelled. A sibling should copy the
decisions.

---

## 1. Registration: two manifests, one plugin, no per-skill manifest

- The repository **is** the plugin. `.claude-plugin/plugin.json:2` names it
  `grimoire`; `.claude-plugin/marketplace.json:11` lists it with `"source": "./"`.
- **A sibling adds no manifest.** `CONTRIBUTING.md:105` states it: "There is no
  per-skill manifest." The default scan reads `skills/<name>/` one level deep, and
  `plugin.json` carries no `skills` array. A skill nested deeper needs one, and
  `scripts/check.mjs:153-162` fails with that exact advice if you try.
- **The shelf and the book must carry different names** — `mephistopheles4` versus
  `grimoire`. Enforced at `scripts/check.mjs:146-148`.
- **The version lives in `plugin.json` and nowhere else.** A `version` key on a
  marketplace entry is a failure, not a mismatch: `scripts/check.mjs:142-144`
  rejects the key rather than comparing it.
- **Every `skills/<name>/` directory must hold a `SKILL.md`** with YAML frontmatter
  carrying a `name`. Enforced twice: the directory at `scripts/check.mjs:153-162`,
  the frontmatter at `scripts/check.mjs:61-63`. The invocation name comes from that
  field, not from the directory, so the name survives whatever the install
  directory is called (`CONTRIBUTING.md:84-86`).
- **There is no `commands/` directory.** `SKILL.md:27` and `README.md:78` both show
  `/eagle-eye <topic>`, and that is the frontmatter `name` as the harness exposes
  it — not a committed command file. Under the plugin route it is
  `/grimoire:eagle-eye` (`README.md:24-25`, `README.md:78`).

**A version bump is due on any change under `skills/`.** `scripts/check.mjs:183-209`
diffs the branch against `origin/main` and fails when `skills/` moved and
`plugin.json`'s `version` did not, because Claude Code ships an update only when
that field moves. Two merged pull requests changed the skill under an unmoved
`0.1.0` before this check existed (`scripts/check.mjs:164-172`).

## 2. The skill directory must be self-contained

`README.md:8-14`: the `npx skills@latest add` route "copies the whole skill
directory, renderer included". So everything a sibling needs at run time lives
under `skills/<name>/` — renderer, `lib/`, template, schema, `reference/`,
`examples/`. eagle-eye keeps all six there.

**No fixed paths, anywhere in a `SKILL.md`.** `scripts/check.mjs:52-60` fails on
`~/.claude`, `/home/<user>` and `C:\Users\` in any `SKILL.md`. A line inside a
block quote is exempt, because a quoted example is not an instruction
(`scripts/check.mjs:56`). The skill instead tells the agent to join the skill base
directory the harness reports to `render.mjs` (`SKILL.md:102-104`).

**The check is `SKILL.md`-only** (`scripts/check.mjs:53` filters on that filename),
so a fixed path in a sibling's `lib/` or `reference/` passes. That is a gap, not a
licence.

## 3. Zero dependencies, and what actually enforces it

There is **no `package.json`, no lockfile and no `node_modules`** in this tree.
That is the enforcement, and it is structural rather than a check: there is
nowhere to declare a dependency. `CONTRIBUTING.md:19-20` states it as "no install
step, because there are no dependencies", and `CONTRIBUTING.md:63-66` as a rule for
patches.

Three consequences a sibling inherits:

- **Tests run on `node --test`**, which ships with Node. `CONTRIBUTING.md:23-26`:
  a test runner from npm "would be the dependency this repository does not take".
- **Validation is hand-rolled rather than ajv** (`skills/eagle-eye/render.mjs:9`).
- **The markdown fence rule is hand-written rather than markdownlint**
  (`CONTRIBUTING.md:72-75`), because "a linter is a dependency wherever it runs,
  including an unpinned `npx` in a workflow".

**No check verifies the rule.** Nothing greps for an `import` of a bare specifier
and nothing fails on a new `package.json`. A sibling that added one would go green.
The rule holds because the tree gives it nowhere to land, which is stronger than a
check but is not the same thing.

## 4. Validation: the validator *is* the schema, and the schema is prose

`skills/eagle-eye/render.mjs:9` states the convention:

> Validation is hand-rolled (no ajv): the checks below ARE the schema.
> box.schema.json documents the same shape.

### How the two stay honest: they do not, by mechanism

- **Nothing reads `box.schema.json`.** A repository-wide search for the filename
  returns four hits, all prose: `README.md:96`, `SKILL.md:367`, the file's own
  `$id` at `box.schema.json:3`, and the comment at `render.mjs:9`. No script, no
  test and no workflow loads it. (Verified with a positive control on the same
  invocation — a search for `eagle-eye` over the same file list returns 117 hits.)
- **One test mentions the schema and pins one field.**
  `tests/render.test.mjs:475`, "a problem statement of whitespace is refused, as
  the schema says", checks that `minLength: 1` plus `pattern: "\\S"` on `problem`
  matches what the renderer trims. That is the whole of the mechanical agreement.

### The divergences, measured

Each case below was rendered through `render.mjs --check` at `aabebed2`. Five are
valid to the renderer and invalid under the schema; one is the reverse.

| Case | `render.mjs` | `box.schema.json` |
|---|---|---|
| Unknown top-level key | accepts | `additionalProperties: false` at the root (`:8`) |
| Typo'd option key (`stawman`) | accepts | `additionalProperties: false` on an option (`:36`) |
| `short` longer than 28 chars | warns (`render.mjs:76`) | `maxLength: 28` (`:40`) |
| Edge tuple of six items | accepts (`render.mjs:97` checks only `length < 3`) | `maxItems: 5` (`:61`) |
| `eyebrow` set to a number | accepts (never validated) | `type: "string"` (`:11`) |
| Preset `title` of `""` | refuses (falsy at `render.mjs:120`) | `type: "string"`, no `minLength` (`:86`) |

The typo'd-key row is the one that costs an author: `strawman` misspelled is
silently a box with no strawman, and the "no strawman" warning is the only tell.

**This is a decision with a known cost, not an accident.** The schema is
documentation of shape; the renderer is the contract. The pairing is kept honest by
one author editing both in one commit, which demonstrably works when it is
remembered — `reframe` landed in `box.schema.json:88-91` and `render.mjs:131-132`
together. **The sibling's obligation is the same discipline, and it should not
assume a machine will catch the drift.**

### The refusal-message convention

A refusal names the field, says what to write, says why it matters, and says where
to read more. Pinned by `tests/render.test.mjs:461`, which asserts four separate
phrases in one message. The exemplar is `render.mjs:40-43`. Its stated reason
(`tests/render.test.mjs:462-464`): an author must be able to fix the box without
opening `render.mjs`.

**Refuse versus warn is a decided distinction.** A field is refused when a warning
would leave it unwritten — stated at `render.mjs:36-37` for the box `problem` and
at `render.mjs:73-74` for an option's `short`. A row's own `problem` is only warned
(`render.mjs:61`), and `render.mjs:36` calls that warning "the proof that a warning
leaves a field unwritten".

**A blank optional field is refused, never ignored** — `who`, `when`
(`render.mjs:44-47`) and a preset's `reframe` (`render.mjs:131-132`). "Leave the
field out rather than write a blank one."

## 5. The CLI surface

```text
node render.mjs <box.json> [--out <page.html>] [--check] [--sel "eagle-eye: ids"]
```

| Flag | Writes | Behaviour |
|---|---|---|
| *(none)* | the page | Validates, writes the HTML, prints findings to stdout. |
| `--check` | nothing | Validates and prints findings for the chosen set. |
| `--sel <code>` | nothing | Prints findings for a configuration. Refuses an unknown id. |
| `--out <path>` | the page, there | Resolved against the working directory (`render.mjs:184`). |

Conventions the surface carries:

- **Two streams, two jobs.** Warnings, the `ok:` line, errors and `wrote <path>`
  go to **stderr** (`render.mjs:170-172`, `:186`); the findings go to **stdout**
  (`render.mjs:175`, `:187`). `tests/helpers.mjs:14-15` states why the runner
  captures both: "a runner that drops either one can only test half of them".
- **Three exit codes, and they mean different things.** `2` is "I could not read
  the file" (`render.mjs:168`) or "you gave me no box path" (`render.mjs:23`); `1`
  is "I read it and it is wrong" (`render.mjs:171`); `0` is success. Pinned by
  `tests/render.test.mjs:556` with the reason: "A caller that cannot tell those
  apart reports a typo as a broken box."
- **A refusal writes nothing.** Asserted twice — `tests/render.test.mjs:401` and
  `:448` both check that no `.html` appears beside the box file.
- **Warnings never block.** They print and the page is still written.
- **A surface that cannot support a finding drops it.** `render.mjs:159-162`
  removes "row not opened" from command-line output, because it measures a reader
  clicking rows and the command line has no such act.
- **The findings lead with the brief.** `render.mjs:153-155` prints `problem:`,
  then `who:` and `when:` when present, before the verdict.

**Two accidents in the argument parser**, both at `render.mjs:21-22`:

- `args.indexOf(a)` returns the *first* index of a value, so a box path that
  repeats an earlier argument's text is mis-parsed.
- `flag()` returns `true` when a flag is last with no value (`render.mjs:21`).
  `--out` handles that (`render.mjs:184` tests `!== true`); `--sel` does not, so a
  bare trailing `--sel` reaches `findings(box, true)` and `render.mjs:143` calls
  `.replace` on a boolean. A sibling should copy the `--out` treatment.

## 6. Where the output file goes

- **With `--out`**: exactly there, resolved against the working directory
  (`render.mjs:184`).
- **Without `--out`**: beside the box file, same basename, `.box.json` or `.json`
  traded for `.html` (`render.mjs:184`).

The naming convention for input is **`<topic>.box.json`**, and it is load-bearing
in three places: `scripts/check.mjs:39` validates every `*.box.json` in the tree,
`scripts/build-pages.mjs:30` renders every one of them, and
`CONTRIBUTING.md:37-41` forbids committing one as a test fixture for exactly that
reason.

**The default output path is an accident with visible litter.** `.gitignore` lists
`site/` but not the sibling `.html`, so a plain render inside the repository leaves
an untracked page next to its box file. This working tree carried four of them
before this branch was cut. **A sibling should either write to a scratch directory
by default or add its artefact to `.gitignore`.**

**A box lives in scratch by default** (`SKILL.md:318-320`), and the skill must say
which it did in one sentence (`SKILL.md:335`). The repository copy is for when the
user asks, and lands in `docs/decisions/` (`AGENTS.md:20`).

## 7. How the template is composed

`lib/template.html` is a **complete, valid HTML document with three comment-shaped
placeholders**. It is not a template language and there is no engine.

| Token | At | Filled with |
|---|---|---|
| `/*TITLE*/` | `template.html:6` | `box.title` with `<`, `>` and `&` **removed**, not escaped |
| `/*DATA*/` | `template.html:250` | `JSON.stringify(box)` with `</` rewritten to `<\/` |
| `/*MODULE*/` | `template.html:253` | `lib/eagle-eye.js`, with its trailing `module.exports` line stripped |

All three are applied by three chained `String.prototype.replace` calls on one line,
`render.mjs:183`. The module strip is at `render.mjs:180`, the `</` escape at
`render.mjs:182`, the title strip at `render.mjs:183`.

Conventions worth copying:

- **The placeholder is a comment.** `/*DATA*/` and `/*MODULE*/` sit where valid
  JavaScript goes, so the unfilled template is still a parseable page.
- **Shared logic lives in `lib/<name>.js`, inlined into the page, and is a CommonJS
  module.** `lib/eagle-eye.js:207` ends with a guarded `module.exports`, which
  `render.mjs:180` strips on the way in. The stated reason
  (`lib/eagle-eye.js:14-16`): the escape lives there "so a test can reach it", and
  the page and the test then run the same function. `tests/render.test.mjs:309`
  pins the strip.
- **The page's shell holds no domain logic.** `template.html:256` says it: "reads
  BOX, calls EagleEye.analyse, paints. No grid logic in here."
- **Any box value that reaches an HTML *attribute* must be whitelist-checked, not
  escaped.** `esc` does not escape the double quote (`lib/eagle-eye.js:17`), so the
  tier — the one box value that lands in a `class` — is checked against a known set
  at `lib/eagle-eye.js:70` and `:159` instead. Both sites carry the reasoning, and
  `lib/eagle-eye.js:69` notes the check deliberately does not lean on the
  validator. This pairing is the escape's whole justification and a sibling
  inherits it: narrow escape **plus** the invariant that no free text reaches an
  attribute.
- **Every finding escapes the box text it interpolates.** `lib/eagle-eye.js:62`,
  `:71`, `:79`, `:84`, `:96`, `:137`, `:186`, and the escape landed in version
  0.3.5 (`SECURITY.md:38-40`). Pinned at
  `tests/render.test.mjs:346` and `tests/esc.test.mjs:105`.

**One accident in the composition, and a sibling must not copy it.**
`render.mjs:183` passes **strings** as the replacement argument to
`String.prototype.replace`. A string replacement is interpreted, not inserted:
JavaScript expands special patterns inside it. Box text is a stranger's text
(`SECURITY.md:13-16`), and `JSON.stringify` does not neutralise those patterns.
**A sibling must pass a function replacement — `.replace(TOKEN, () => value)` —
so that box text cannot rewrite the template around itself.** This has a
consequence beyond correctness; that consequence is being reported to the
maintainer through the private channel `SECURITY.md:84-88` names, and is
deliberately not described here.

## 8. Design tokens and the font

- **The Drafting tokens are inline, in one `:root` block**, `template.html:10-19`.
  There is no shared stylesheet and no second copy in the repository — a search for
  `--dw-paper` returns `template.html` alone. A sibling that wants the same look
  copies the block.
- **The rules are stated in one comment**, `template.html:9`: "one ink on one
  paper; amber = caution only, green = normal only; neutrals are ink at alpha; no
  radius, no shadow." The ink ramp is annotated by role at `template.html:36-39` —
  `ink-80` secondary prose, `ink-55` annotation and captions, `ink-30` and `ink-12`
  hairlines.
- **A spacing scale, and nothing hardcodes a gap that is on it**
  (`template.html:14-15`).
- **The Google Fonts link is one bare `<link>`**, `template.html:7`, for IBM Plex
  Mono at three weights with `display=swap`. There is no `preconnect`. The fallback
  stack is inside the `--dw-font` token (`template.html:13`), so a blocked
  stylesheet degrades to a system monospace.
- **That link is the only external reference the page makes, and it is deliberate
  and tested.** `SECURITY.md:186-194` names it: "self-contained" means every line
  of script and style that runs is in the file, not that no request is made.
  `tests/render.test.mjs:290` asserts the count is exactly one and states the test's
  own width — it reads `src` and `href` on `script`, `link` and `img`, so a CSS
  `@import`, a `url()`, a `fetch` or an `iframe` stays green.
- **The palette is light-only.** `:root` is defined once with no
  `prefers-color-scheme` block. Whether that is a decision is not recorded.
- **The generated index page does not use the tokens.** `scripts/build-pages.mjs:57-63`
  writes a generic `ui-sans-serif` page with `color-scheme: light dark`. The site's
  front door and the pages it links are two different designs. **Accident, on the
  evidence** — nothing records a reason.

## 9. What `scripts/build-pages.mjs` does with `site/`

- Walks the whole tree for `*.box.json`, skipping `node_modules`, `.git` and
  `site/` (`build-pages.mjs:24-33`).
- Shells out to `render.mjs` once per box, with `--out site/<basename>.html`
  (`build-pages.mjs:38-40`).
- Writes `site/index.html` itself, linking each page by title and showing the
  source path (`build-pages.mjs:45-77`).
- `site/` is gitignored (`.gitignore:2`) and built fresh by the `pages` workflow on
  every push to `main` (`.github/workflows/pages.yml:25-34`).

Two conventions:

- **It reuses the renderer's own escape rather than keeping a copy.**
  `build-pages.mjs:16-21` records why: the private copy "rendered a missing value as
  the string `undefined`", and "two escapes are two things to get right, and the
  second one had no test".
- **The publisher shells out to the renderer's CLI.** It does not import the
  validator. So the CLI is the seam for the site as well as for the agent.

**Both walkers skip by a hardcoded list, not by `.gitignore`, and that is an
accident.** `scripts/check.mjs:22` and `scripts/build-pages.mjs:24` each declare
`SKIP = new Set(['node_modules', '.git', 'site'])`. `.gitignore:3` also excludes
`.claude/worktrees/`, and neither walker knows it. On this machine that made
`node scripts/check.mjs` fail with 26 failures, every one of them inside a stale
worktree copy — the check validating three other checkouts of itself. CI never
sees it, because a fresh checkout has no worktrees, so the gap is invisible where
it is measured. **A sibling that adds a walker should read `.gitignore` or extend
both lists.**

**The output namespace is flat, and that is an accident.**
`build-pages.mjs:39` keys on `basename` alone, so two boxes with the same file name
in different directories render to the same `site/<name>.html` and the second wins,
silently. Nothing detects it. **A sibling adding a second artefact type to `site/`
should key on the path, not the basename.**

## 10. The check, the tests, and what they deliberately do not cover

**One command is the contract** (`CONTRIBUTING.md:9-17`): `node scripts/check.mjs`.
CI runs it as a required check called `check` (`.github/workflows/check.yml:23`),
with `fetch-depth: 0` because the version rule needs a merge base
(`.github/workflows/check.yml:15-19`). Actions are pinned to commit SHAs with a
version comment beside them.

`check.mjs` enforces six rules, listed at `scripts/check.mjs:6-14`. Four are
generic and already apply to a sibling on the day it lands:

1. **No fixed path in any `SKILL.md`** (`:52-60`).
2. **The single-pass tag strip cannot return** (`:71-79`) — a shape guard over every
   `.mjs`, `.js` and `.html`, from a CodeQL finding triaged in `SECURITY.md:143-163`.
3. **No fenced code block declares no language** (`:104-119`), over every `.md` in
   the tree, including this file. It is a state machine, not a per-line regex, and
   `scripts/check.mjs:88-99` records why: the regex version reported sixteen hits of
   which thirteen were closing fences.
4. **Manifests agree, and every skill directory has a `SKILL.md`** (`:130-162`).
5. **A change under `skills/` carries a version bump** (`:183-209`).

**Rule 1 — box files validate — is eagle-eye-specific** (`:39-49`), and this is the
obligation nothing in the ticket's file list states outright. `check.mjs` and
`build-pages.mjs` both key on `*.box.json` and on `render.mjs`. **A sibling with its
own artefact format is validated by nothing and published by nothing until it wires
itself into both scripts.** Neither script has a plug-in point; both name eagle-eye
by path (`check.mjs:41`, `build-pages.mjs:23`). Extending them is part of adding
the skill, not a follow-up.

**Every path out of a check says which one it took.** This is the single most
repeated rule in the repository: "A check that silently does nothing reads as a
check that passed" appears at `scripts/check.mjs:187`, `:233-237` and
`tests/check.test.mjs:1-2`. It is why there are five distinct skip notices around
the test step (`:188`, `:190`, `:199`, `:231`, `:247`, `:250`) and why
`scripts/check.mjs:246` re-throws anything that is not `ENOENT`.

**The check reports every failure at once**, not the first — pinned by
`tests/check.test.mjs:172`.

### What the tests assert

`tests/` holds three files plus `helpers.mjs`, run by `check.mjs` as its last step
(`:230-263`), guarded against recursion by `GRIMOIRE_IN_TEST` (`:227-229`).

- `tests/check.test.mjs` — 26 tests. Each **copies the parts of the tree the check
  reads into a temporary directory, breaks exactly one thing, and asserts the check
  says so by message**, not merely that it failed (`tests/check.test.mjs:52-53`:
  "A check that goes red for the wrong reason is a check nobody can act on"). Two
  tests build a real git repository to reach the version-bump rule
  (`tests/check.test.mjs:259-272`).
- `tests/render.test.mjs` — 41 tests, all through the command line.
- `tests/esc.test.mjs` — 9 tests, pinning the escape **in both directions**: what it
  escapes and what it lets through (`tests/esc.test.mjs:33`, the double quote).
  `tests/esc.test.mjs:8-11` states why: a test that asserted only "it escapes
  things" would go green if somebody widened it *and* green again if somebody
  narrowed it back.

Two testing rules a sibling must follow, both in `CONTRIBUTING.md:37-46`:

- **Never commit an artefact file as a fixture.** The tree walkers would either fail
  on a broken one or publish a valid one. Read the shipped example, or write the
  malformed case to a temporary directory at run time.
- **Test at the seam a reader uses** — the renderer's command line, the check's exit
  code and output. "A test that reaches inside either one breaks on a refactor that
  changed no behaviour."

### What they deliberately do not cover

Each of these is stated in the tree, which is itself the convention — **say the
width of a guard rather than let it read as total**:

- **The escape's consumers.** `SECURITY.md:78-82`: the tests exercise `esc`, not the
  `innerHTML` calls that consume it. "The claim above is still read by a reviewer,
  not by a machine."
- **The external-reference test's width.** Only `src`/`href` on `script`, `link`,
  `img` (`tests/render.test.mjs:297-299`).
- **The single-pass strip guard holds a shape, not a hole**
  (`scripts/check.mjs:67-70`).
- **Line length and every other markdown rule.** Only the bare fence is checked
  (`scripts/check.mjs:100-103`).
- **Whether a SHA pin's version comment is true** (`SECURITY.md:165-171`).
- **Whether any relied-on GitHub setting is switched on** (`SECURITY.md:125-129`).
- **The two judgements no validator can make**: `SKILL.md:388-394` — no validator
  can tell a dimension from a menu of positions, and none can tell you a row is
  missing.

## 11. Prose conventions

- **A skill's prose follows the rules that skill teaches.** `CONTRIBUTING.md:87-91`:
  "A patch that breaks the rule the skill teaches is the worst kind of patch here."
  For eagle-eye that is ASD-STE100 tested against ISO 24495-1, set out at
  `reference/writing-edges.md:31-45`.
- **Reference material lives in `reference/<topic>.md`** and `SKILL.md` links to it
  rather than restating it.
- **A comment explains the failure that produced the code**, in the past tense, with
  the measurement. `scripts/check.mjs:88-99`, `lib/eagle-eye.js:98-112` and
  `template.html:41-42` are the pattern: what was tried, what broke, what the
  numbers were.
- **A format specified in more than one place is changed in all of them or none.**
  `CONTRIBUTING.md:93-95` and `SKILL.md:456` both name the export format's three
  places: the page writes it, `SKILL.md` specifies it, the agent reads it back.

## 12. Accidents, collected

A sibling should not copy these.

| Accident | Where | Cost |
|---|---|---|
| String replacement in the template splice | `render.mjs:183` | Box text can rewrite the page. See §7. |
| `--sel` with no value crashes | `render.mjs:21`, `:143` | Unhandled `TypeError` instead of the usage line. |
| `args.indexOf` finds the first match | `render.mjs:22` | A repeated argument value mis-parses the box path. |
| Default output writes untracked litter | `render.mjs:184`, `.gitignore` | Four stray pages in this working tree. |
| `site/` keyed on basename | `build-pages.mjs:39` | Same-named boxes overwrite each other silently. |
| Fixed-path check reads `SKILL.md` only | `check.mjs:53` | A fixed path in `lib/` or `reference/` passes. |
| Walkers skip by hardcoded list, not `.gitignore` | `check.mjs:22`, `build-pages.mjs:24` | The check walks stale worktrees; red locally, green in CI. |
| Index page ignores the Drafting tokens | `build-pages.mjs:57-63` | The front door and its pages are two designs. |
| Schema drift is caught by nothing | §4 | Five documented constraints the renderer does not hold. |

## 13. The three that most constrain a sibling's design

1. **The one-command contract is not generic.** `check.mjs` and `build-pages.mjs`
   both hard-code `*.box.json` and `render.mjs`. A sibling's artefacts are validated
   by nothing and published by nothing until it edits both scripts, and every
   `skills/` change owes a `plugin.json` version bump.
2. **The skill directory is the unit of distribution.** `npx skills` copies it
   whole, so the renderer, its `lib/`, its template and its reference all live
   inside `skills/<name>/`, with no dependency to install, no manifest of its own,
   and no fixed path to anything.
3. **The validator is the schema, and it must teach.** No ajv, no schema loaded at
   run time; the checks in code are the contract, a JSON Schema file beside them is
   documentation kept in step by hand, and every refusal names the field, says what
   to write, says why, and says where to read more.

Close behind, and inseparable from the template: **the escape is narrow because no
box text reaches an HTML attribute.** A sibling's template inherits that invariant
or must widen the escape, and any value that does reach an attribute is
whitelist-checked rather than escaped.

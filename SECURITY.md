# Security

## What this project is, in threat terms

`grimoire` is a marketplace of Claude Code skills. A skill is prose plus, in
eagle-eye's case, a renderer: `render.mjs` reads a box file — JSON — and writes
one self-contained HTML page. There is no server, no account, no database, and
nothing is uploaded anywhere. Node runs the renderer locally, and the reader
opens the page in a browser.

So the realistic risks are narrow, and worth naming precisely:

- **A box file is input from a stranger.** The point of eagle-eye is that
  people share configurations. A `.box.json` you did not write becomes an HTML
  page you open, and its text lands in the page. That is the main risk in this
  repository.
- **A skill is an instruction file an agent obeys.** Anybody who can change a
  `SKILL.md` here can change what Claude does on a reader's machine. That is
  what branch protection is for, below.
- **A dependency reaching a reader.** The renderer imports node built-in
  modules only, so there is no dependency tree to poison today. That is a fact
  about now, not a guarantee about later.

## What the renderer actually does with box text

Stated with line numbers, because "it escapes things" is not a threat model:

- **`skills/eagle-eye/render.mjs:155` escapes `</` before it writes the box JSON into a
  `<script>` block**, so a `why` string that contains `</script>` cannot close
  the block.
- **`skills/eagle-eye/lib/eagle-eye.js:17` escapes `&` and `<`** before box text reaches
  `innerHTML`. **It does not escape the double quote.** The template calls it at
  `skills/eagle-eye/lib/template.html:257`; `render.mjs` inlines the module into the page,
  so the page and the test run the same function.
- **No box text reaches an HTML attribute today.** Every interpolated attribute
  in the template holds an option id, a number, or a fixed class name, and ids
  are validated against `^[a-z0-9][a-z0-9-]*$` at `skills/eagle-eye/render.mjs:27`.

Those two facts hold together. The escape is narrow, and it is enough only
because nothing puts box text where a quote would matter. **If somebody adds an
attribute that interpolates a label, a `why`, or a `note`, the escape stops
being enough.** A reviewer should treat any new `="${` in the template as a
change to this file.

**Both escapes are now covered by tests, and the tests pin the width rather
than only the behaviour.** [`tests/esc.test.mjs`](tests/esc.test.mjs) asserts
that `&` and `<` are escaped **and** that the double quote passes through, so
widening the escape and narrowing it back are each a visible test change rather
than a silent one. [`tests/render.test.mjs`](tests/render.test.mjs) renders a
box whose `why` carries `</script><script>…</script>`, and asserts the payload
reaches the page with the slash escaped and closes no script block. The escape
lives in `lib/eagle-eye.js`, and not beside the markup that calls it, for
exactly this reason: a function inside a 49 KB template is a function no test
can reach.

An earlier version of this file recorded the opposite — "No test covers the
escape function" — which was true when it was written and is the reason the
tests exist.

**What the tests do not cover.** They exercise the escape, not the five
`innerHTML` calls that consume it. A test that asserted "no box text reaches an
attribute" would need to parse the rendered page, and nothing here does that
yet. The claim above is still read by a reviewer, not by a machine.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** — the "Report a
vulnerability" button under this repository's Security tab. It goes to the
maintainer and nobody else.

Do not open a public issue for anything above, or for anything that would let a
crafted box file run script in a reader's browser or change what an agent does.

This is a personal project maintained by one person. There is no SLA and no
bounty. What you will get is an honest answer and, if the finding is real, a
fix and a line in this file that records it.

## Scope

**In scope:** anything in this repository — both manifests, every `SKILL.md`,
the renderer, the template, the check scripts, and the CI workflows.

**Out of scope:** Claude Code itself, your own box files and what you choose to
put in them, and wherever you host a page the renderer wrote.

## What the platform is relied on for

Some of this project's defence is a GitHub setting rather than a file in this
repository, and that distinction matters more than it looks:

| | |
| --- | --- |
| Dependabot alerts | vulnerabilities in the dependency tree |
| Dependabot security updates | a pull request per alert with an available patch |
| Dependabot malware alerts | a dependency found to be malicious, not merely vulnerable |
| CodeQL (default setup) | static analysis of the JavaScript, including `lib/template.html` |
| Private vulnerability reporting | the channel this file points at |
| Branch protection on `main` | pull request required, `check` must pass, no bypass |
| Pages, built from Actions | what the `pages` workflow deploys to a public URL |

One line of dependency defence is **in** the tree and does go red:
[`.github/dependabot.yml`](.github/dependabot.yml) asks for weekly
`github-actions` updates. Version updates are that file; **security** updates
are the setting above. Both exist, and they are not the same thing.

**Nothing in this repository can check that any of them is switched on.** They
live in repository settings, outside the tree, so a clone cannot read them. This
section is a statement of what the project **relies on**, not a claim about what
is currently true. If you are auditing this repo and that distinction matters to
you, check the settings themselves; the file cannot tell you.

**CodeQL is enabled, and the first version of this file argued that it should
not be.** That argument counted one `.mjs` file and one `.js` file and called
the finding rate too low to justify a check. It was wrong, and the way it was
wrong is worth recording. CodeQL's JavaScript extractor processes `.html`, and
`lib/template.html` holds about 49 KB of inline script — every `innerHTML` sink
in this project, and the `esc` function above. The one place in this repository
where a scanner has something to say is the one place the argument did not
count.

**It is not a required check yet.** A check that blocks on an untriaged ratio is
one people learn to route around.

**Its first scan raised two alerts, both `js/incomplete-multi-character-
sanitization`, both rated high, and both the same one-line function copied into
two files.** `strip` removed HTML tags from an option label in one pass, at
`render.mjs:128` and `lib/template.html:445`. Here is the triage, because "we
fixed it" tells an auditor nothing:

- **The output never reaches HTML.** `strip` feeds a Markdown export that lands
  in a `<textarea>` `.value` and the clipboard, and a console line. Neither is
  an HTML sink, so no bypass of it becomes script.
- **A bypass is hard to build against this regex anyway.** `<[^>]+>` matches
  from the first `<` to the first `>`, so a nested `<scr<script>ipt>` is
  consumed whole rather than reassembled into a tag.
- **It was fixed regardless**, because the safe form is one line: repeat the
  replacement until the string stops changing. `scripts/check.mjs` fails if the
  single-pass form returns.

So: a real pattern, not a reachable vulnerability, fixed and guarded. **CodeQL
did not flag the sink this file was most worried about** — the `esc` function
and the five `innerHTML` calls above. That is worth knowing. A clean scan there
is not evidence the escape is right; it is evidence the query set had nothing
to say about it.

**Every action is pinned to a commit SHA**, with a version-shaped comment beside
it. The pins were resolved from the GitHub API at the time of writing, not from
memory. **What no check here holds is whether the comment is true** — that
`3d3c42e…` really is `v7.0.1` of `actions/checkout` is a fact living at GitHub,
actions have no lockfile, and a hand-edit swapping in a different valid SHA
under an unchanged comment would pass. That is the mitigation; it is not
immunity.

## What is deliberately not defended against

Stated plainly, because a threat model that claims everything is defended is not
a threat model:

- **A box file you chose to open.** The renderer runs on your machine, on a file
  you pointed it at. The escape above is the guard, and this file states its
  exact width. A box file from somebody you do not trust deserves a read first.
- **A skill you chose to install.** Installing a plugin means an agent reads its
  prose and acts on it. That is the product working as intended. Read a skill
  before you install it, here or anywhere.
- **A malicious maintainer account.** Branch protection raises the cost of a bad
  commit. It does not survive a stolen account with admin rights.
- **The one request the page makes when you open it.** "Self-contained" means
  every line of script and style that runs is in the file. It is not "makes no
  network request": the page links one Google Fonts stylesheet, and falls back
  to a system font stack when that fails. So opening a page tells Google you
  opened it. `tests/render.test.mjs` asserts that this is the only external
  reference, which makes a second one a red test rather than a discovery —
  **at one width**: the test reads `src` and `href` on a `script`, `link` or
  `img` element. A CSS `@import`, a `url()`, a `fetch` or an `iframe` is a
  second way out that stays green. Widening the test is cheap; nobody has
  needed to yet.

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

- **`skills/eagle-eye/render.mjs:196` escapes `</` before it writes the box JSON into a
  `<script>` block**, so a `why` string that contains `</script>` cannot close
  the block.
- **`skills/eagle-eye/lib/eagle-eye.js:17` escapes `&` and `<`** before box text reaches
  `innerHTML`. **It does not escape the double quote.** The template calls it at
  `skills/eagle-eye/lib/template.html:270`; `render.mjs` inlines the module into the page,
  so the page and the test run the same function.
- **The six findings escape the same way.** They are built in
  `skills/eagle-eye/lib/eagle-eye.js`, not in the template, and the page assigns their
  text to `innerHTML` at `skills/eagle-eye/lib/template.html:355`. Every row name,
  option name and `why` a finding prints goes through the escape. Until
  version 0.3.5 they did not, and a row name containing a tag reached the page
  as markup.
- **No box text reaches an HTML attribute today.** Every interpolated attribute
  in the template holds an option id, a number, or a fixed class name, and ids
  are validated against `^[a-z0-9][a-z0-9-]*$` at `skills/eagle-eye/render.mjs:41`.
  One attribute is written by the module rather than the template — the tier
  name in `class="tier …"` on the *weakest edge* finding — and the module
  reduces anything that is not `measured`, `sourced` or `argued` to `argued`
  before it writes it. `render.mjs` refuses such a box anyway; the module does
  not lean on that.

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

`tests/esc.test.mjs` also runs one box whose row names, option names and `why`
all carry `<img …>`, fires all six findings on it, and asserts that none of
them writes the tag and that the names still appear as text. That test is at
the module and not at the command line, because the findings are built in the
browser: the payload never reaches the file `render.mjs` writes, and
`--check` strips every tag before it prints.

**What the tests do not cover.** They exercise the escape and the text the
findings build, not the `innerHTML` calls that consume it. A test that asserted
"no box text reaches an attribute" would need to parse the rendered page, and
nothing here does that yet. That claim is still read by a reviewer, not by a
machine.

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
| `skillspector` as a required status check | a SkillSpector finding blocking a merge, rather than being merged over |
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
`render.mjs:161` and `lib/template.html:485`. Here is the triage, because "we
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

## The skill prose is scanned, and the scan gates

CodeQL reads the JavaScript. Nothing read the prose, which is the part of this
repository an agent obeys — the risk this file opens with.
[SkillSpector](https://github.com/NVIDIA/SkillSpector) does, and
[`.github/workflows/skillspector.yml`](.github/workflows/skillspector.yml) runs
it on every pull request and every push to `main`.

**Pinned to `b7241089d7ec15d8b30df980dacbb428214732b9`, which is `v2.11.0` in
the `NVIDIA` repository.** The owner is part of the pin: a fork of this scanner
exists elsewhere. The pin is a commit, matching the convention every `uses:`
line here follows — and unlike those, **Dependabot does not watch it.** Its
`github-actions` ecosystem reads `uses:` lines and the scanner arrives through
a `run:` line, and there is no pip manifest to read instead. So this pin rots
silently and a bump is a reviewed pull request. The workflow says so in a
comment.

**A finding fails the build, at any severity.** Not the scanner's exit code and
not its risk score. Both answer "should I install this whole skill" against a
fifty-point threshold, and this was measured rather than assumed: a file
carrying an instruction override and a credential read was added to the skill
tree during triage, the scanner found both and rated them high, and it exited
`0` — two findings across thirty files score 42. An advisory check would have
shipped that green, which is the failure this repository already wrote a commit
about. [`scripts/skillspector-gate.mjs`](scripts/skillspector-gate.mjs) reads
the report's `issues` array instead, and
[`tests/skillspector-gate.test.mjs`](tests/skillspector-gate.test.mjs) covers
every branch of it. **A scan that errored, did not complete, or read only part
of the tree fails as well**, because a broken scan must not read as a clean one.

**Static analysis only.** `--no-llm`: patterns, AST and YARA, no model call, no
API key, no login, no secret in the workflow. The semantic pass — which
compares a skill's behaviour against its stated purpose, and is arguably the
failure this repository could actually ship — needs a provider credential and
is a separate decision nobody has taken.

**Fifteen findings from six rules, and all fifteen are wrong.**
[`.skillspector-baseline.yaml`](.skillspector-baseline.yaml) suppresses those
six by rule identifier, with a reason per entry:

| Rule | | Why it is a false positive |
| --- | --- | --- |
| `AR2` | Anti-Refusal Statement | `SKILL.md` tells the agent that a preview pane may render the page without script, so do not judge it from one. It adds a caveat; it does not suppress one. |
| `AS3` | Skill Enumeration | A `README.md` line naming the one skill this repository ships, and the decision records quoting it. Naming your own product is not enumerating somebody else's. |
| `EA2` | Autonomous Decision Making | The `why` text on an edge in the example box file. It is content the renderer prints for a reader. |
| `MP3` | Memory Manipulation | A comment in the page template describing how **Reset** discards the reader's overrides and **Undo** offers them back. It documents a button. |
| `RA2` | Session Persistence | The `CONTRIBUTING.md` rule forbidding a fixed path inside a skill, and the test proving that rule fires. A guard and its test, reported as the risk they prevent. |
| `RP1` | Unpinned MCP server | The `README.md` install command and quotations of it. `skills` is the Vercel Labs installer run through `npx`, not an MCP server. |

**Keyed by rule identifier and not by fingerprint**, which is a trade stated
rather than hidden. A fingerprint is bound to the text it was taken from and
reactivates whenever that text or the scanner version changes; on prose this
repository rewrites constantly it would expire without telling anybody. A rule
key survives a rewording, and it also suppresses that rule everywhere. The
reasons above are what that breadth is paid for with.

**Nothing was reworded to satisfy a pattern matcher.** Two of these findings sit
on a security rule in `CONTRIBUTING.md` and on the test that proves it works.
Letting a regex edit that prose is the trap, and refusing it is a decision.

**There are two baseline files.** The scanner finds a baseline only at the top
of the directory it was pointed at, and a reader scanning the skill is pointed
at the skill, so
[`skills/eagle-eye/.skillspector-baseline.yaml`](skills/eagle-eye/.skillspector-baseline.yaml)
repeats the three rules that fire inside it. `node scripts/check.mjs` fails if
the two disagree — same rules, same words — so a suppression cannot be argued
one way in one file and another way in the other.

**Scanning this repository yourself gets the reasons, not silence.** With no
flags the scanner reports the unchanged score and tells you a baseline was
shipped; `--use-shipped-baseline` applies it, and `--show-suppressed` lists
every suppression with the reason above beside it. Opting in stays your choice,
which is why publishing one costs no honesty.

**SkillSpector also reaches this repository through CodeRabbit**, which ran
2.8.2 against pull request 9. That finding arrived inside a collapsed block
while the check reported `pass`, and that run cannot be configured, baselined,
or made to fail anything. It is outside this repository's control and is not
what the table above relies on.

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
  opened it. The generated `site/index.html` links the same stylesheet, for
  the same reason and with the same fallback, so the landing page every
  visitor hits makes the request as well. `tests/render.test.mjs` asserts
  this is the only external reference on a rendered page and
  `tests/build-pages.test.mjs` asserts the same of the index, which makes a
  third one a red test rather than a discovery. Both bound what the page
  **loads on its own**; a link the reader clicks is not that, and the index
  carries one to GitHub —
  **at one width**: the test reads `src` and `href` on a `script`, `link` or
  `img` element. A CSS `@import`, a `url()`, a `fetch` or an `iframe` is a
  second way out that stays green. Widening the test is cheap; nobody has
  needed to yet.

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

- **`render.mjs:146` escapes `</` before it writes the box JSON into a
  `<script>` block**, so a `why` string that contains `</script>` cannot close
  the block.
- **`lib/template.html:257` escapes `&` and `<`** before box text reaches
  `innerHTML`. **It does not escape the double quote.**
- **No box text reaches an HTML attribute today.** Every interpolated attribute
  in the template holds an option id, a number, or a fixed class name, and ids
  are validated against `^[a-z0-9][a-z0-9-]*$` at `render.mjs:27`.

Those two facts hold together. The escape is narrow, and it is enough only
because nothing puts box text where a quote would matter. **If somebody adds an
attribute that interpolates a label, a `why`, or a `note`, the escape stops
being enough.** A reviewer should treat any new `="${` in the template as a
change to this file.

**No test covers the escape function.** It is one line, it has never been
exercised by a red test, and this file says so rather than implying otherwise.

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

**In scope:** anything in this repository — the marketplace manifest, each
plugin manifest, every `SKILL.md`, the renderer, the template, and the CI
workflows.

**Out of scope:** Claude Code itself, your own box files and what you choose to
put in them, and wherever you host a page the renderer wrote.

## What the platform is relied on for

Some of this project's defence is a GitHub setting rather than a file in this
repository, and that distinction matters more than it looks:

| | |
| --- | --- |
| Dependabot alerts | vulnerabilities in the dependency tree |
| Dependabot malware alerts | a dependency found to be malicious, not merely vulnerable |
| Private vulnerability reporting | the channel this file points at |
| Branch protection on `main` | pull request required, `check` must pass, no bypass |

**Nothing in this repository can check that any of them is switched on.** They
live in repository settings, outside the tree, so a clone cannot read them. This
section is a statement of what the project **relies on**, not a claim about what
is currently true. If you are auditing this repo and that distinction matters to
you, check the settings themselves; the file cannot tell you.

**CodeQL is deliberately not enabled.** Its default setup analyses TypeScript
and JavaScript, and this repository holds one `.mjs` file and one `.js` file,
both without dependencies. The finding rate would not justify a required check
that people learn to route around. Revisit this if the renderer grows.

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

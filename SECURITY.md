# Security

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: the "Report a vulnerability"
button under this repository's Security tab. It reaches the maintainer and
nobody else.

Do not open a public issue for a security problem. That includes anything that
would let a crafted file run script in a reader's browser, or change what an
agent does.

This is a personal project with one maintainer. There is no SLA and no bounty.
You will get an honest answer and, if the finding is real, a fix.

## Scope

**In scope:** everything in this repository. That means both manifests, every
`SKILL.md`, the renderers and page templates, the edge audit, the check
scripts, and the CI workflows.

**Out of scope:** Claude Code itself, your own box and flightpath files and what
you put in them, and wherever you host a page the renderer wrote.

## What this project is, in threat terms

grimoire is a set of agent skills. A skill is prose an agent follows, plus a
renderer that turns a JSON file into one self-contained HTML page. There is no
server, no account and no database. Node runs the renderer on your machine, and
neither the renderer nor the page makes a network request.

One script can send data, and only when somebody runs it: eagle-eye's optional
edge audit. See [What the edge audit sends](#what-the-edge-audit-sends).

The attacks worth planning for, scenario by scenario, with what stops each
one and what still gets through: [docs/security/threat-model.md](docs/security/threat-model.md).

The realistic risks:

- **A file from a stranger.** Box and flightpath files are made to be shared. A
  file you did not write becomes a page you open, with its text in the page.
  This is the main risk here.
- **A skill is an instruction file an agent obeys.** Whoever can change a
  `SKILL.md` can change what an agent does on a reader's machine. Branch
  protection guards this.
- **A dependency.** The renderers import Node built-in modules only, so there is
  no dependency tree to poison. That is true now, not a promise about later.
  `scripts/check.mjs` fails on a `package.json` or a lockfile.
- **An API key in the environment.** The edge audit reads one and sends it as a
  bearer token. Review any change to `skills/eagle-eye/audit.mjs`, its
  endpoints, or how it picks a key as a change that could send a key elsewhere.

## Pages built from a stranger's text

**Author text is escaped for element content and never reaches an HTML
attribute.** Both pages escape `&` and `<`, and deliberately not the double
quote. That narrow escape is enough only because every attribute holds an id,
a number or a fixed string. Ids are validated against a strict pattern.

- **Adding an attribute that carries author text needs a different escape.**
  Treat any new `="${` in a template as a security change.
- **Nothing from a file is safe as an object key, ids included.** An id like
  `constructor` passes validation but collides with `Object.prototype`. Use
  maps with no prototype.
- **The pages make no network request.** Fonts are vendored and inlined, and
  tests assert zero external references on every page and the site index.
- **The escape lives in a module, not in the template**, because a function
  inside a template is a function no test can reach. Tests pin its exact width.

The details, the tests, and what they do not cover:
[`docs/security/rendering.md`](docs/security/rendering.md).

## What the edge audit sends

`skills/eagle-eye/audit.mjs` asks a model provider to rank a box's `argued`
edges for rereading. It is the only file here that opens a connection, and it
is opt-in twice: it needs a key in the environment, and the skill runs it only
after the user says yes.

- **What leaves the machine.** For each argued edge: the box's `problem`, the
  edge's `why`, and both options' labels, rows, `why`, `notes` and `src`.
  Nothing else from the disk. `--dry-run` prints a request and sends nothing.
- **Who receives it.** TypeSafe directly, or TypeSafe through OpenRouter. Never
  both, and never one as a fallback. What they do with the text is their
  policy. Do not audit a box whose text you would not send.
- **The key.** Read from `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` only. It is
  never printed or written, and a key in the wrong variable is refused before
  anything is sent.
- **What it never does.** It never writes the box, never changes an edge's
  tier, keeps no cache, and never runs in the tests or in CI.

The full account, including endpoints, provider logging opt-ins, exit codes and
the test override: [`docs/security/edge-audit.md`](docs/security/edge-audit.md).

## Scanners in CI

- **CodeQL** reads the JavaScript, including the page templates.
- **SkillSpector** reads each skill's prose and fails on any finding the
  baseline does not cover. Every suppression carries a written reason.
- **zizmor** audits the workflows and fails on any finding. There is no
  baseline, because there is nothing to suppress.
- **Every action is pinned to a commit SHA**, and zizmor checks each SHA
  matches its version comment.

A scan that errors or reads only part of the tree fails, rather than passing
quietly. What each scanner covers, what it suppresses, and why:
[`docs/security/scanners.md`](docs/security/scanners.md).

## What the platform is relied on for

Part of this project's defence is GitHub settings, not files. A clone cannot
read them, so this table says what the project **relies on**, not what is
switched on right now. If that matters to you, check the settings themselves.

| Setting | What it provides |
| --- | --- |
| Dependabot alerts | vulnerabilities in the dependency tree |
| Dependabot security updates | a pull request per alert with an available patch |
| Dependabot malware alerts | a dependency found to be malicious, not merely vulnerable |
| CodeQL (default setup) | static analysis of the JavaScript, including the page templates |
| Private vulnerability reporting | the channel at the top of this file |
| Branch protection on `main` | pull request required, `check` must pass, no bypass |
| SkillSpector's `scan` job as a required check | a SkillSpector finding blocks a merge |
| zizmor as a required check | a workflow finding blocks a merge |
| Pages, built from Actions | what the `pages` workflow deploys to a public URL |

[`.github/dependabot.yml`](.github/dependabot.yml) is in the tree and asks for
weekly `github-actions` updates. Those are version updates. Security updates
are the setting above.

## What is deliberately not defended against

- **A file you chose to open.** The renderer runs on your machine, on a file you
  pointed it at. Read a file from someone you do not trust first.
- **A skill you chose to install.** An agent reads a skill's prose and acts on
  it. That is the product working. Read a skill before you install it, here or
  anywhere.
- **What the provider does with a box you chose to audit.** After a yes, the
  text is under the provider's policy.
- **A malicious maintainer account.** Branch protection raises the cost of a
  bad commit. It does not survive a stolen admin account.

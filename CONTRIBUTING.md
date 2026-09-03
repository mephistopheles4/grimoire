# Contributing

`grimoire` is a marketplace of Claude Code skills. A skill is mostly prose that
an agent obeys, so a patch here changes what a machine does on somebody else's
computer. That is the reason for the rules below, and it is the only reason.

## The short version

```bash
node scripts/check.mjs
```

That is the contract, and it is still one command. It validates every
`*.box.json` in the tree with the eagle-eye renderer, checks that no file a
skill ships has grown a fixed path back, fails on a code fence that declares no
language, fails on a dependency, fails when the two SkillSpector baselines
disagree, and runs the test suite in `tests/`. CI runs it as a required check
called `check`. `main` takes no direct pushes.

A second workflow scans the skill prose with SkillSpector and fails on any
finding the baselines do not cover. It installs the scanner on the runner and
never on your machine, so the command above stays the only one you need. See
[`SECURITY.md`](SECURITY.md) for what it suppresses and why.

It walks what `.gitignore` does not exclude, so a worktree under
`.claude/worktrees/` is not descended into and not checked. Only the root
`.gitignore` is read.

You need Node 20 or later and nothing else. There is no install step, because
there are no dependencies.

## Tests

The tests run on `node --test`, which ships with Node. That is the whole reason
they exist: a test runner from npm would be the dependency this repository does
not take, and `SECURITY.md` explains why that matters more than it looks.

`node scripts/check.mjs` runs them, so there is no second command to forget. To
run only the suite while you work on it:

```bash
node --test tests/esc.test.mjs tests/render.test.mjs tests/check.test.mjs tests/build-pages.test.mjs tests/skillspector-gate.test.mjs
```

Two rules about what goes in there:

**Never commit a box file as a fixture.** `scripts/check.mjs` and
`scripts/build-pages.mjs` both walk the whole tree for `*.box.json`. A broken
fixture fails the check, and a valid one is rendered and published to the public
site. Read the box file the skill already ships, or write the malformed one to a
temporary directory at run time. `tests/render.test.mjs` does both.

**Test at the seam a reader uses.** The renderer's seam is its command line, and
the check's seam is its exit code and its output. A test that reaches inside
either one breaks on a refactor that changed no behaviour.

That is also why a `git worktree` needs no setup here. Add one and run the
check; there is nothing to install, link, or copy first.

## What a good patch looks like

**One change, one reason.** A pull request that fixes a typo and rewrites a
procedure is two reviews wearing one hat.

**Say what you tested.** "Ran `node scripts/check.mjs`, green" is enough for a
prose change. For a renderer change, say which box file you rendered and what
you looked at on the page.

**A behaviour change carries a test.** Not a coverage target — there is none.
The rule is narrower: if the patch changes what the renderer or the check does,
the pull request shows the test that fails without it.

**Do not add a dependency.** The renderer is deliberately zero-dependency: it
imports node built-in modules and nothing else. A patch that adds a package
needs to argue for itself in the pull request body before anybody reads the
diff. See [`SECURITY.md`](SECURITY.md) for why this matters more than it looks.

`node scripts/check.mjs` enforces this. It fails on a `package.json`, a
lockfile, and any `.mjs` or `.js` file importing a bare specifier — an import
path that is not relative, not absolute, and not a `node:` builtin. It reads
code and not prose, so a comment is skipped. Until this check existed the rule
held only because the tree gave it nowhere to land.

**Give every box file a name no other box file wants.**
`scripts/build-pages.mjs` names each published page after the box file's path
from the repository root, with the separators flattened:
`docs/decisions/x.box.json` becomes `docs-decisions-x.html`. Flattening a path
onto one name is not injective, so `grid/one.box.json` and `grid-one.box.json`
both ask for `grid-one.html`. The build refuses and names both files rather
than publishing one over the other. Rename one.

**Give every code fence a language.** `node scripts/check.mjs` fails on a fence
that declares none, and names the file and the line. Use `text` for a block
that is neither code nor markup — a typed command, a plain example.

This is a hand-written rule and not markdownlint, on purpose. A linter is a
dependency wherever it runs, including an unpinned `npx` in a workflow, and
adopting one would start with a decision about its line-length rule that nobody
has taken. The rule catches a bare fence and nothing else.

## Rules that are specific to skills

**Never write a fixed path to a file inside a skill.** A skill can be installed
as a plugin, copied by hand, or vendored into a project, and each lands in a
different directory. Reference the skill base directory the harness supplies.
`scripts/check.mjs` fails on `~/.claude/` appearing in any file under `skills/`
— the prose, the library, the reference pages, the renderer and the schema. A
block-quoted line in a markdown file is exempt, because a quoted example is not
an instruction. Only markdown is exempted: `>` is quotation in prose and is
nothing in JavaScript, JSON or HTML.

**Keep the frontmatter `name`.** Claude Code takes the skill's invocation name
from it, so the name survives whatever the install directory is called.

**Write to the skill's own rules.** eagle-eye's prose follows ASD-STE100 tested
against ISO 24495-1: active voice, present tense, one instruction per sentence,
twenty words or fewer, no idiom. See
[`skills/eagle-eye/reference/writing-edges.md`](skills/eagle-eye/reference/writing-edges.md).
A patch that breaks the rule the skill teaches is the worst kind of patch here.

**Changing the export format touches three places.** The page writes it,
`SKILL.md` specifies it, and the agent reads it back. All three in one commit,
or none.

## Adding a new skill

1. Put it at `skills/<name>/SKILL.md`, with a frontmatter `name` and
   `description`.
2. Bump `version` in `.claude-plugin/plugin.json`. The check fails without it,
   because Claude Code ships an update only when that field moves.
3. Run `node scripts/check.mjs`.

There is no per-skill manifest. The repository is one plugin and every skill
lives under it. A skill nested deeper than `skills/<name>/` needs an explicit
`skills` array in `plugin.json`; the check says so if you try.

Open an issue first if the skill is large. It is easier to agree on scope before
you write ten pages than after.

## Reporting a security problem

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).

## Conduct

By taking part you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

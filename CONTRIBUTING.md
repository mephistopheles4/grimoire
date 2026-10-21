# Contributing

`grimoire` is a marketplace of Claude Code skills. A skill is mostly prose that
an agent obeys, so a patch here changes what a machine does on somebody else's
computer. That is the reason for the rules below, and it is the only reason.

## The short version

```bash
node scripts/check.mjs
```

That is the contract, and it is still one command. It validates every
artifact in the tree with the renderer its registry row names, checks that no
file a skill or the mod ships has grown a fixed path back, fails on a skill
frontmatter key outside its allow-list and on a hidden character in a skill
file, fails on a place or a manifest key the engine loads from that no rule
reads, fails on a code fence that declares no
language, fails on a dependency, fails when a skill's SkillSpector baseline entry
gives a different reason from the root's or is broader than it, and runs the test suite in `tests/`. CI
runs it as a required check called `check`. `main` takes no direct pushes.

Three more workflows check things the command above does not. One runs SkillSpector
over the skill prose and fails on any finding the baselines do not cover, and on
any file it reads only in part unless `.skillspector-allowances.json` accepts that
partial read by name, or a finding that reports a reference to an accepted file. The command above holds each accepted file to its content
hash, so an edit to one fails until its entry is updated in the same pull request, with a new dated "Re-read on" sentence in its reason. One
runs zizmor over `.github/workflows/` and fails on any finding at all —
there is no baseline for it, because there is nothing to suppress. The third runs
`claude plugin validate --strict` on the two manifests and `skills/`, at a pinned
Claude Code version, and fails on any field the schema does not recognise in
either manifest; its check of `skills/` is weaker. All
three put their tool on the runner and never on your machine, so the command above
stays the only one you need. See [`docs/security/scanners.md`](docs/security/scanners.md) for what each one
covers, what it suppresses, and why.

It walks what `.gitignore` does not exclude, so a worktree under
`.claude/worktrees/` is not descended into and not checked. Only the root
`.gitignore` is read. A file git tracks that `.gitignore` matches fails, because
it would ship with no rule reading it; in CI the check also fails when it
cannot ask git which files it tracks.

You need Node 24 or later and nothing else. There is no install step, because
there are no dependencies. The skills' own scripts and the one command share
that floor, and CI runs on it. `tests/brigade-view.test.mjs` imports the Brigade
mod's TypeScript modules as they are, which Node 24 does by default.

## Run the check in a container

`node scripts/check.mjs` stays the one command, and CI runs it. Where
athanor is installed, it is the
preferred way to run it: athanor runs the check in a fresh Linux container with
no network, and caps how many runs go at once on the machine, so several
sessions can check without breaking each other through files, ports or
temporary folders. It is optional. Nothing here requires it.

The root `package.json` holds only the `athanor` key, because athanor reads its
configuration from nowhere else. It names the Dockerfile in `tests/container/`,
which is the whole build context, and two commands:

```bash
athanor run check
athanor run fast
```

`check` runs the same contract as `node scripts/check.mjs`, and it is the one
that counts. `fast` runs the test files that do not spawn the check, in about
a third of the time, and skips the check's rules, so a pass there is not a
contract pass.

To install athanor, use its checkout at commit `0fd9ad4`, the commit this
configuration was tested with, outside this repository's tree: run `npm ci`,
then `npm run prepack`, then `npm install -g .`. athanor is not published, and
this repository never depends on it.

- Stage new files, or pass `--untracked`. athanor runs the tracked files as
  they are in the working tree and leaves untracked ones out.
- A container run cannot cover the version-bump check or the SkillSpector
  allowance change notice, which need `origin/main`, nor the plugin validator,
  SkillSpector or zizmor, which stay in CI. A container pass does not cover
  them.
- Exit 124, 125 and 137 mean athanor produced no result, whether from a time
  limit, Docker or its configuration. Run `node scripts/check.mjs` on the host.
- The cap on concurrent runs is athanor's machine setting `maxRuns`, 2 unless
  you change it.
- A run sends your tracked files, with unsaved edits, to the Docker engine
  athanor is set to use. Use the local engine, and keep secrets out of tracked
  files. athanor keeps short-lived copies of unsaved files in its state folder.
- The image build has network access, unlike the run. It also uses the
  machine's registry login. Read the diff to `tests/container/` and to the
  `athanor` key before you run athanor on a branch you did not write.

## Tests

The tests run on `node --test`, which ships with Node. That is the whole reason
they exist: a test runner from npm would be the dependency this repository does
not take, and `SECURITY.md` explains why that matters more than it looks.

`node scripts/check.mjs` runs them, so there is no second command to forget. To
run only the suite while you work on it:

```bash
node --test tests/audit.test.mjs tests/brigade-roster-rules.test.mjs tests/brigade-view.test.mjs tests/brigade-warning.test.mjs tests/build-pages.test.mjs tests/case.test.mjs tests/check-allowances.test.mjs tests/check-baseline-rules.test.mjs tests/check-baselines.test.mjs tests/check-format.test.mjs tests/check-home-paths.test.mjs tests/check-home-shapes.test.mjs tests/check-load-surface.test.mjs tests/check-manifests.test.mjs tests/check-mod.test.mjs tests/check-paths.test.mjs tests/check-skill-files.test.mjs tests/check-test-step.test.mjs tests/check-tracked.test.mjs tests/check-tree.test.mjs tests/check-version.test.mjs tests/contract-interview.test.mjs tests/contract-page.test.mjs tests/contract-render.test.mjs tests/eagle-eye-sheets.test.mjs tests/esc.test.mjs tests/groundtrack-fold.test.mjs tests/groundtrack-render.test.mjs tests/groundtrack-sheets.test.mjs tests/practice.test.mjs tests/registry.test.mjs tests/render.test.mjs tests/skillspector-gate.test.mjs tests/skillspector-probe.test.mjs tests/skillspector-strip-suppressed.test.mjs
```

**The suite never reaches the network.** eagle-eye's edge audit is the one
script in the tree that sends anything, apart from the Brigade pane's `gh` call,
which the mod's tests answer with a fake. `tests/audit.test.mjs` runs the audit
against a fake service bound to `127.0.0.1` inside the test process. It clears
any real key from the child's environment first, so a key in your shell is
never used. CI never calls the provider. A test that did would spend money and
hand a key to a runner. A new test that needs the service uses the fake.

Two rules about what goes in there:

**Never commit an artifact as a fixture.** `scripts/check.mjs` and
`scripts/build-pages.mjs` both walk the whole tree for every suffix
`scripts/lib/registry.mjs` names — `*.box.json`, `*.flightpath.json` and `*.interview.json` today.
A broken fixture fails the check, and a valid one is rendered and published to
the public site. Read the artifact the skill already ships, or write the
malformed one to a temporary directory at run time. `tests/render.test.mjs` and
`tests/groundtrack-render.test.mjs` both do this.

**Test at the seam a reader uses.** The renderer's seam is its command line, and
the check's seam is its exit code and its output. A test that reaches inside
either one breaks on a refactor that changed no behaviour. The check's two small
helpers, `scripts/lib/case.mjs` and `scripts/lib/printable.mjs`, are seams of
their own: `tests/case.test.mjs` imports them for the cases a file system
cannot hold, and the check's tests drive the same cases through its output
where it can. The Brigade mod's
seam is its view module, `brigade/view.ts`: plain TypeScript with no engine
import, which `tests/brigade-view.test.mjs` imports directly to check what
the pane would draw, as strings. Its roster module, `brigade/roster.ts`, is the
second seam: `tests/brigade-roster-rules.test.mjs` imports it to check the
roster's shape rules, its byte cap and the path rule that decides whether the
roster file may be read or written. Its permission warning's wording module,
`brigade/warning-text.ts`, is the third: `tests/brigade-warning.test.mjs`
imports it to pin the wording and check the "Don't show again" test. Keep all
three to erasable syntax (no enums, namespaces or parameter properties), so
Node can strip their types. The
contract skill's hiring page has a seam of its own: `tests/contract-page.test.mjs`
renders it through the interview script's `--out`, runs the page's own
scripts on a small stand-in document, picks its controls by the keys the page
gives them, such as `blank:<id>` and `chip:<id>:<n>`, and reads what the
page saved to its store. Those keys and the saved entry are the page's seam.

**Two more gates for the mod's `set_roster` tool, run on your own machine.**
They drive a live Claude Code session, so they run where you have one. CI fetches
Claude Code in one place only, the plugin validator's workflow, and that is not
the publishing path: the job has `contents: read`, holds no token or secret,
writes nothing, and the `pages` workflow does not depend on it. Before a pull request that
touches `brigade/`, run the first on any platform, and the second on Windows,
and say in the pull request which you ran. Off Windows, say that the recording
gate could not run there:

```bash
claude plugin test .
node scripts/record-brigade-stats.mjs
```

The first runs `brigade/set-roster.test.ts` and `brigade/warning.test.tsx`
under the engine's own plugin test runner, which drives each tool the way the
model calls it. That runner gives a
plugin no file system, so the test answers every `stat`, read and write from a
small file system in memory, and its answers about links, and the way a
folder listing shows each kind of entry, come from
`brigade/recorded-stats.ts`. The second builds real junctions, symbolic links
and hard links in a temporary folder, asks the installed Claude Code to `stat`
each one and to list the folder that holds them, through a throwaway probe
plugin, and fails if the answers differ from that recording; `--write` records
them anew. It loads none of your settings,
hooks or plugins into that session, and makes no model call while the probe
loads. It runs on Windows only, where the recording was made: on macOS or Linux
it says so and fails, since there is no recording there to compare with. It
needs Developer Mode for symbolic links, and a link it cannot create fails it
rather than being skipped.

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

`node scripts/check.mjs` enforces this. It fails on a lockfile, in any case,
and on any `package.json` except one: the root `package.json` that holds only
an `athanor` key whose value is an object (see "Run the check in a container"
above). Any other key fails and is named, `Package.json` and a `package.json`
in a folder fail, and so does a `binding.gyp` at the root, which npm would
build. It also fails on any code file importing a bare specifier — an import path that
is not relative, not absolute, and not a `node:` builtin. A path starting with
`//` names a host, so it counts as a package, not as absolute. Code means every
suffix Node or the Claude Code engine loads: `.ts`, `.tsx`, `.jsx`, `.js`,
`.mjs`, `.cjs`, `.mts` and `.cts`. Inside the mod (see below), `claude-code`
and the paths under it, such as `claude-code/testing`, are builtins too,
because the engine supplies them; anywhere else they are a package. It reads
code and not prose, so a comment is skipped. Until this check existed the rule
held only because the tree gave it nowhere to land.

**Give every artifact a page name no other artifact wants.**
`scripts/build-pages.mjs` names each published page after the artifact's path
from the repository root, with the separators flattened:
`docs/decisions/x.box.json` becomes `docs-decisions-x.html`. Two artifacts
sharing a basename in different directories are both legal and both publish —
that is what path keying is for. Flattening a path onto one name is not
injective, though, so `grid/one.box.json` and `grid-one.box.json` both ask for
`grid-one.html`. The build refuses and names both files rather than publishing
one over the other, and it refuses before it renders anything. Rename one.

The comparison folds case, because the filesystem this site is built from folds
case and two names differing only in case silently became one file there.

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
`scripts/check.mjs` fails on `~/.claude/` or a home path appearing in any file
under `skills/`, `brigade/` or `hooks/` — the prose, the library, the
reference pages, the renderer and the schema. A home path is a Linux, Windows
or Mac home in any of the shapes a terminal or an editor writes it:
`C:\Users\…`, `C:/Users/…`, `/Users/…`, Git Bash's `/c/Users/…` and the WSL
and Cygwin forms. An example path takes a placeholder instead, such as
`<repo>/.claude/worktrees/build-185`; there is no per-line opt-out. A
block-quoted line in a markdown file is exempt, because a quoted example is not
an instruction. Only markdown is exempted: `>` is quotation in prose and is
nothing in JavaScript, JSON or HTML. The check also fails a file git tracks
that `.gitignore` matches, because nothing reads it and it still ships: remove
the ignore line, or untrack the file.

**Keep the frontmatter `name`.** Claude Code takes the skill's invocation name
from it, so the name survives whatever the install directory is called.

**Use only the allow-listed frontmatter keys.** A `SKILL.md` may hold `name`,
`description`, `compatibility`, `license`, `allowed-tools` and `metadata` at
the top of its frontmatter, and `scripts/check.mjs` fails on any other key,
naming the file and the key. Claude Code acts on some keys: a `hooks` key
registers hooks when the skill is invoked. The list is `SKILL_KEYS` in
`scripts/check.mjs`; a pull request that adds a key says what Claude Code does
with it. The check judges key names only, never their values, though a line
it cannot read as one key is quoted, masked and cut, in its failure. Write the
frontmatter's keys at the left margin, and fence it with lines of exactly
`---`: an indented first key and a fence with anything after it both fail.

**No hidden characters in a skill file.** The check fails on any file under
`skills/` that holds a control character other than tab, line feed and
carriage return, a carriage return not followed by a line feed, DEL, U+2028,
U+2029, U+FFFE, U+FFFF, a default ignorable code point (tag characters,
zero-width characters, the soft hyphen, variation selectors) or a bidi
control, and names the file, the line and the code point. A BOM is allowed as
a file's first character only.
Each can make the diff you review differ from the text the model reads. Every
file is read as text unless the check's binary list names its suffix and the
file opens with that format's signature, so a new kind of binary file fails
until the list names it, and a text file renamed `.woff2` is still read.

**Write to the skill's own rules.** eagle-eye's prose follows ASD-STE100 tested
against ISO 24495-1: active voice, present tense, one instruction per sentence,
twenty words or fewer, no idiom. See
[`skills/eagle-eye/reference/writing-edges.md`](skills/eagle-eye/reference/writing-edges.md).
A patch that breaks the rule the skill teaches is the worst kind of patch here.
groundtrack's prose follows the same controlled English.

**A skill depends on nothing the reader does not have.** It needs no other
skill, command or tool to do its job, and it hands off to none. The test is
one question: *does this skill still work for a reader who has only this
repository and the tools it says it targets?*

**Naming a tool the skill is built for is normal.** A skill that writes,
reads or checks files for a named tool names that tool, its file format and
its keys, because the reader using that feature has the tool. The rest of its
prose still says *the agent*, and never asserts a named tool's behaviour as
if every reader had it.

**For everything that is not a target, the test is per sentence.** One
question a stranger can run: *does this sentence stay true and checkable for a
reader who has only this repository and the tools the skill says it targets?*
A borrowed name fails it twice — the reader cannot resolve it, and the
sentence asserts something about a tool they do not have.

**The test is per sentence, not per word.** Ordinary English that collides with
an outside name is fine: *during brainstorming* costs the reader nothing. A
sentence built on a named tool's behaviour is not, even when every word in it
is ordinary — *"Brainstorming has the clarifying questions answered and has not
yet proposed approaches"* asserts a phase sequence only one tool has.

**A citation is not vocabulary.** A `src` field records where a claim came
from, so it points outside this repository by definition — a chat turn, a
document, an earlier artifact, a runtime's manual. Genericise it and it cites
nothing, and the renderer refuses a `sourced` edge that names no `src` anyway.
This is scope, not an exception: the rule governs the words a reader must
resolve to use the skill, and a citation is a pointer for somebody checking the
claim. It covers the field only. The `why` beside it obeys the rule.

State a skill's occasion as a bare fact instead: *for a plan already made or
work already done*, or *any walk through a plan one decision at a time*. A
skill that couples itself to vocabulary the reader may not have is a skill that
stops working when they do not have it. Why the per-sentence test and not a
narrower one:
[`docs/adr/0001-skills-own-their-vocabulary.md`](docs/adr/0001-skills-own-their-vocabulary.md).
Why a skill may name the tools it targets:
[`docs/adr/0005-skills-name-their-targets.md`](docs/adr/0005-skills-name-their-targets.md).

**A skill with a `CONTRACT.md`, beside its `SKILL.md` or in its `references/`, is generated from it.**
Today that is `skills/contract/`, `skills/eagle-eye/` and `skills/head-chef/`. Do not edit such a
`SKILL.md` by hand. Change the contract and raise its `Version:` line,
generate the `SKILL.md` again, then validate the skills folder:

```bash
claude plugin validate --strict skills
```

That checks that each frontmatter parses, and nothing about a key's meaning.

Nothing seals a generated `SKILL.md` and nothing checks it against its
contract, so a reviewer reads every changed file in full, and reviews the
`SKILL.md` as shipped prose.

**The mod is held to the same rules.** The plugin can also ship a Claude Code
mod: a hooks module the engine runs in every session the plugin is installed
in. Today that is Brigade, the `/brigade` pane. Its code and its state contract
live in `brigade/`; `hooks/hooks.json` at the plugin's root, the file the mods
reference requires, names the module as `../brigade/register.tsx`. The check
holds both folders to the fixed-path rule and the version bump, as it holds
`skills/`. It also holds the code the engine runs inside them: each module a
hooks file names, every quoted `./` or `../` path in the mod's code, with either slash, and
the manifest's `hooks` and `types` paths must land in `brigade/` or `hooks/`;
an import line the check reads may not hold an absolute path; no shipped root
folder (`skills/`, `.claude-plugin/`, `brigade/`, `hooks/`), nor
`hooks/hooks.json`, nor either manifest in `.claude-plugin/`, may be spelled in
another case; and a hooks file may
hold nothing but `modules`, because a settings hook there would run a command
no rule reads. A mod kept in any other folder is outside those rules until
`MOD_DIRS` in `scripts/check.mjs` names it. The engine writes its own type declarations into
`.claude-plugin/types/` at every load; `.gitignore` excludes them, so never
commit them and the check never reads them.

**The engine loads more than the mod.** It also loads components from default
places at the plugin root (`commands/`, `agents/`, `output-styles/`, `workflows/`,
`themes/`, `monitors/`, `bin/`, `.mcp.json`, `.lsp.json`, `settings.json`, a root
`SKILL.md`), and from manifest and marketplace keys that add components, run a
command or change what installs. The check fails on a root entry named like one
of those places, in any case, and on a key in `plugin.json` or
`marketplace.json` outside a short allow-list of metadata and the two pointers
it reads. It reads the root from the disk, so an untracked `.mcp.json` fails
too: the engine loads one when it loads this folder as a plugin directory, as
`claude --plugin-dir .` does. It reads names only and never opens the file.
The lists are in rule 6c of `scripts/check.mjs`. To use a place, take it off
`LOAD_ROOTS` and hold it to the rules the mod's folders are held to. To use a
key, add it to its allow-list with a reason; a key that loads or runs
something also needs a rule that reads where it points, as the `hooks` key is
read.

**Changing the export format touches three places.** The page writes it,
`SKILL.md` specifies it, and the agent reads it back. All three in one commit,
or none.

## Adding a new skill

1. Put it at `skills/<name>/SKILL.md`, with a frontmatter `name` and
   `description`.
2. If it ships an `examples/` directory, add a row to
   `scripts/lib/registry.mjs` naming the artifact's file suffix and the
   renderer that owns it. The check fails on such a skill with no row, because
   a gate that quietly does nothing reads as a gate that passed. A prose-only
   skill produces no artifact and needs no row.
3. Bump `version` in `.claude-plugin/plugin.json`. The check fails without it,
   because Claude Code ships an update only when that field moves. The same
   holds for a change to the mod. It also
   fails when `main` already carries the version you bumped to, which is what
   happens when a sibling branch lands first. Rebase and bump again.

   That second comparison reads the `origin/main` on your disk, so run
   `git fetch origin` first. Without it you are compared against a base that
   may have moved hours ago.
4. Run `node scripts/check.mjs`.

There is no per-skill manifest. The repository is one plugin and every skill
lives under it. Each skill sits at `skills/<name>/`: the engine scans one level
deep, and the `skills` key in `plugin.json` that would reach a deeper folder is
refused by rule 6c. The check says so if you try.

Open an issue first if the skill is large. It is easier to agree on scope before
you write ten pages than after.

## Reporting a security problem

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).

## Conduct

By taking part you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

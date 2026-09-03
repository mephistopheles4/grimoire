# grimoire

A spellbook of agent skills for AI. Cast wisely.

Two skills today, more later. Works with any agent:

```bash
npx skills@latest add mephistopheles4/grimoire
```

That is [`skills`](https://github.com/vercel-labs/skills), which installs into
Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, Zed, opencode, Amp
and around seventy more. It copies the whole skill directory, renderer
included.

**Claude Code users can install the plugin instead**, if you would rather have
the marketplace handle updates:

```text
/plugin marketplace add mephistopheles4/grimoire
/plugin install grimoire@mephistopheles4
```

Plugin skills are namespaced, so that route invokes them as
`/grimoire:eagle-eye` and `/grimoire:groundtrack`. The installer route keeps the
plain `/eagle-eye` and `/groundtrack`.

Either way you get both skill directories, each with its `SKILL.md` and the
renderer that goes with it:

- [`skills/eagle-eye/`](skills/eagle-eye) — coupled decisions, as a
  morphological box.
- [`skills/groundtrack/`](skills/groundtrack) — a plan or a written change, as
  a call graph you can step through.

---

## eagle-eye

**A decision is made once it has been seen against the whole system.**

Most tools ask about one decision at a time. That works until the decisions are
coupled — until picking the cheap database changes what the deployment can be,
which changes who can be on call. Then a list of questions hides the thing you
need to see.

eagle-eye draws a **morphological box** instead. One row per decision. One cell
per option. An **edge** between two options that rule each other out, or that
require each other. Then it renders a page that reads any configuration back.

**Live example: [the decision to publish this repository][demo].** Click an
option and watch the grid recolour. That page was written by the skill, about
itself.

[demo]: https://mephistopheles4.github.io/grimoire/

### What the page tells you

Seven findings. Six read the configuration you are looking at; the seventh
reads the box itself:

| Finding | What it points at |
| --- | --- |
| row not opened | A row with edges to the rows you changed on the page, that you did not open. |
| weakest edge | The lowest-evidence edge your verdict depends on. Measure this one first. |
| most connected | The option with the most edges. Change it and the most moves. |
| row with no edges | Independent, or an edge is missing. |
| strawman not rejected | A deliberately weak option that nothing rules out. Give the reason, or pick it. |
| chain | Edges that join into a relation, and whether the box says that relation itself. A cycle reports on its own. |
| evidence for the verdict | If every edge is true, can the set still be wrong? Names the rows whose active edges are all argued. |

### Why the edges carry a tier

Every edge states **why**, and every edge is `measured`, `sourced`, or `argued`.
An argued edge is your reasoning, and the page colours on it exactly as hard as
it colours on a measurement. Naming the tier is how you find out that a
confident-looking verdict rests on three guesses.

### Use it

Ask for it by name:

```text
/eagle-eye <topic>
```

Or let it trigger: three or more open decisions, where one choice changes what
is possible in another.

### Run the renderer by hand

No install, no dependencies. Node 20 or later:

```bash
node skills/eagle-eye/render.mjs <box.json> --out page.html
```

`--check` validates a box and prints the findings without writing a file.
`--sel "eagle-eye: opt-a, opt-b"` reads a configuration from the command line.

The box file's shape is in
[`box.schema.json`](skills/eagle-eye/box.schema.json). A
complete example is
[`eagle-eye-skill.box.json`](skills/eagle-eye/examples/eagle-eye-skill.box.json)
— the skill's own design, boxed.

---

## groundtrack

**A reader who did not write a change cannot see its shape.**

A change arrives as a list of files. A plan arrives as a list of tickets.
Neither says what calls what, what each part hands back, where it can break, or
what it needs in order to work.

groundtrack turns durable material — a plan already made, or work already
done — into a call graph a reader can step through. The agent reads the
material and hand-writes one `<topic>.flightpath.json`, which states one graph
and one or more recorded walks through it. A zero-dependency renderer turns
that file into one self-contained page.

Every node carries three channels:

- **A** — what flows out of the node.
- **E** — where it breaks: each failure tag is a retry, an escape, or a die.
- **R** — what it needs to work.

The page draws the graph and steps a cursor over one recorded walk. Nothing is
computed while you watch: every branch an `if` took, every value an effect
returned, and every catch is a literal in the file. That is what makes the walk
a list of checkable claims rather than a program you have to believe.

A **layer** redraws the same graph under a different set of dependencies. Flip
to the test layer, and a node that still reaches the real network under test is
a design defect you can see rather than a sentence you have to trust.

Ask for it by name. The installer route keeps the plain name; the plugin route
namespaces it:

```text
/groundtrack <a plan, a change, a path>
/grimoire:groundtrack <a plan, a change, a path>
```

Or run the renderer directly:

```bash
node skills/groundtrack/scripts/render.mjs <topic>.flightpath.json --check
node skills/groundtrack/scripts/render.mjs <topic>.flightpath.json --out page.html
node skills/groundtrack/scripts/render.mjs <topic>.flightpath.json --text
```

`--check` validates and prints its findings. `--text` prints the same graph as
an indented tree, so the answer in a reply and the answer on the page are one
graph seen two ways.

The file's shape is in
[`flightpath-file.md`](skills/groundtrack/references/flightpath-file.md), and
the validator is what enforces it — no machine-readable schema ships, because a
second artifact that can silently disagree with the first is not worth having.
Three complete examples sit in
[`skills/groundtrack/examples/`](skills/groundtrack/examples): a small one that
uses every move kind, a real pull request with a test layer, and a plan of
sixteen tickets.

**The page makes no network request at all.** Three monospace faces ship with
the skill and are inlined into the page.

**The honesty property has a stated limit.** The validator proves the walk is a
legal path through the graph the file declares. It cannot prove which branch
was taken or what an effect returned. Those stay the author's claims, and the
skill says so rather than hiding it.

---

## Install by hand

If you want neither installer, copy the directory yourself:

```bash
git clone https://github.com/mephistopheles4/grimoire.git
cp -r grimoire/skills/eagle-eye ~/.claude/skills/
cp -r grimoire/skills/groundtrack ~/.claude/skills/
```

Neither skill names a fixed path to its own renderer, so each runs from
wherever it lands. eagle-eye has been run from three directories: the author's
skills folder, the plugin install, and a copy made by `skills`.

## How the repository is put together

The repository **is** the plugin. `.claude-plugin/plugin.json` names it
`grimoire`; `.claude-plugin/marketplace.json` is the shelf that lists it with
`"source": "./"`. Skills sit at `skills/<name>/`, which is the one level the
default scan reads and the layout the `skills` installer finds first.

The two manifests carry different names on purpose: the shelf is
`mephistopheles4`, the book is `grimoire`. The version lives in `plugin.json`
and nowhere else, because a second copy is a second place to forget.

This shape follows [mattpocock/skills](https://github.com/mattpocock/skills),
which ships a marketplace manifest and a plugin manifest side by side at the
root. The Claude Code docs describe each separately and never that pairing, so
the evidence it works is a repository that does it, plus
`claude plugin validate .` passing here.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md). The contract is one command:

```bash
node scripts/check.mjs
```

Security problems go through private reporting, not a public issue:
[`SECURITY.md`](SECURITY.md).

## Licence

[MIT](LICENSE). © 2026 Ayman Diab.

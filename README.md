# grimoire

A spellbook of agent skills for AI. Cast wisely.

One skill today, more later. Works with any agent:

```bash
npx skills@latest add mephistopheles4/grimoire
```

That is [`skills`](https://github.com/vercel-labs/skills), which installs into
Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, Zed, opencode, Amp
and around seventy more. It copies the whole skill directory, renderer
included.

**Claude Code users can install the plugin instead**, if you would rather have
the marketplace handle updates:

```
/plugin marketplace add mephistopheles4/grimoire
/plugin install eagle-eye@grimoire
```

Either way you get [`skills/eagle-eye/`](plugins/eagle-eye/skills/eagle-eye) —
[`SKILL.md`](plugins/eagle-eye/skills/eagle-eye/SKILL.md) and the renderer that
goes with it.

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

Six findings, computed for whatever configuration you are looking at:

| Finding | What it points at |
| --- | --- |
| row not opened | A row that your changes touch, and you did not look at. |
| weakest edge | The lowest-evidence edge your verdict depends on. Measure this one first. |
| most connected | The option with the most edges. Change it and the most moves. |
| row with no edges | Independent, or an edge is missing. |
| strawman not rejected | A deliberately weak option that nothing rules out. Give the reason, or pick it. |
| cogency | If every edge is true, can the set still be wrong? |

### Why the edges carry a tier

Every edge states **why**, and every edge is `measured`, `sourced`, or `argued`.
An argued edge is your reasoning, and the page colours on it exactly as hard as
it colours on a measurement. Naming the tier is how you find out that a
confident-looking verdict rests on three guesses.

### Use it

Ask for it by name:

```
/eagle-eye <topic>
```

Or let it trigger: three or more open decisions, where one choice changes what
is possible in another.

### Run the renderer by hand

No install, no dependencies. Node 20 or later:

```bash
node plugins/eagle-eye/skills/eagle-eye/render.mjs <box.json> --out page.html
```

`--check` validates a box and prints the findings without writing a file.
`--sel "eagle-eye: opt-a, opt-b"` reads a configuration from the command line.

The box file's shape is in
[`box.schema.json`](plugins/eagle-eye/skills/eagle-eye/box.schema.json). A
complete example is
[`eagle-eye-skill.box.json`](plugins/eagle-eye/skills/eagle-eye/examples/eagle-eye-skill.box.json)
— the skill's own design, boxed.

---

## Install by hand

If you want neither installer, copy the directory yourself:

```bash
git clone https://github.com/mephistopheles4/grimoire.git
cp -r grimoire/plugins/eagle-eye/skills/eagle-eye ~/.claude/skills/
```

The skill names no fixed path to its own renderer, so it runs from wherever it
lands. It has been run from three directories: the author's skills folder, the
plugin install, and a copy made by `skills`.

## Why the skill lives four directories down

`plugins/eagle-eye/skills/eagle-eye/` is the layout the Claude Code plugin
system needs, and `skills` finds it there without help — its lock file records
that exact path. The nesting costs a person browsing the repository one extra
click, and it costs neither installer anything. That trade is written up in
[`docs/decisions/portable-skill.box.json`](docs/decisions/portable-skill.box.json),
which you can read as a page on the [demo site][demo].

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md). The contract is one command:

```bash
node scripts/check.mjs
```

Security problems go through private reporting, not a public issue:
[`SECURITY.md`](SECURITY.md).

## Licence

[MIT](LICENSE). © 2026 Ayman Diab.

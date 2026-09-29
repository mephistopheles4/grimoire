# Skills name their targets

A skill in this repository depends on nothing the reader does not have. It
needs no other skill, command or tool to do its job, and it hands off to none.
A skill that writes, reads or checks files for a named tool names that tool,
its file format and its keys, because the reader using that feature has the
tool. The rest of its prose still says *the agent*, and never asserts a named
tool's behaviour as if every reader had it. The test is one question: *does
this skill still work for a reader who has only this repository and the tools
it says it targets?* The occasion was pull request 155, which reads and checks
agent files for Claude Code, Antigravity and Codex. On 2026-09-29 the owner
decided to "point it more at dependencies … it's normal we talk about the
tools we are building skills for".

## Considered Options

**Keep 0001's rule unchanged.** It forbids every tool-specific noun, so a skill
that checks a named tool's files could not name the tool, its format or its
keys. The reader of that skill has the tool, so the name costs them nothing,
and a generic word hides which files the skill handles.

**Allow the named targets, and keep the rest of 0001.** Chosen. The risk 0001
guards against is a skill that stops working when the reader lacks something.
A named target does not create that risk; a dependency does. So the rule now
tests dependencies, and names that a reader already has are allowed.

## Consequences

**What stays from 0001.** A skill still names no other skill and hands off to
none. Everything that is not a named target still meets the per-sentence test.
Prose other than the target's name, format and keys still says *the agent*.

**What this supersedes in 0001.** The "tool-specific noun" clause, and the
consequence "The host platform is not an exception". 0001's other consequences
stay: nothing enforces the rule mechanically, there is no allowlist, a `src`
field is out of scope, code that calls a service names it, and the lost
provenance stays lost.

**A target is only what the skill says it targets.** A skill states its
targets. A tool it does not state as a target is still outside vocabulary, and
the per-sentence test applies to it unchanged.

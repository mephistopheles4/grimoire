---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

/contract

In the earlier turns the person asked for a skill that writes release notes. You proposed the type (skill), the level (Standard) and the name (`release-notes`), and they confirmed all three. You and they agreed what good output looks like, from an example they pasted.

The person asked for chat. Over the earlier turns you asked every question of the Standard level and they answered all of them. The answers, each with its mark, are:

- purpose: *Confirmed*. Turns a merged change list into release notes for customers.
- why: **Decided**, in their words: "Customers never read our commit log, so they miss what changed."
- good: **Decided**. Short, dated, no internal ticket ids.
- roles: *Confirmed*. It drafts the notes and the person approves each one.
- tools: *Confirmed*. Reads files; writes only the notes file; no network.
- rules: *Confirmed*. Never publishes.
- writing: *Confirmed*. Plain words, short sentences, no idiom.

You have not shown the whole contract in one message. The person writes: "looks good, build it".

Say what you do next.

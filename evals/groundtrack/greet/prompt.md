---
max_turns: 40
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/groundtrack

Here is a small change: `greet` now greets a user by name and falls back to a plain hello when the name store has no row. The file set is `src/greet.ts` and `src/name-store.ts`. Draw the graph for the one entry point, `greet`, validate it, show the test layer too, and render the page to the scratch folder.

`src/greet.ts` (edited, +12 -3):

```ts
import { lookupName, NoSuchUser } from "./name-store";
import { post } from "./http";

export class SendFailed extends Error {}

// greet a user by name, or fall back to a plain hello
export async function greet(userId: string): Promise<string> {
  let name = "";
  try {
    name = await lookupName(userId); // the only call that can fail
  } catch (e) {
    if (!(e instanceof NoSuchUser)) throw e; // anything else is a defect
  }
  const line = name ? "Hello, " + name : "Hello there";
  const res = await post("/greetings", { body: line }); // POST the greeting
  if (!res.ok) throw new SendFailed("greeting was not accepted");
  return line;
}
```

`src/name-store.ts` (new, +24):

```ts
import { db } from "./db";

export class NoSuchUser extends Error {}

export async function lookupName(id: string): Promise<string> {
  const row = await db.get("names", id); // read the name row
  if (!row) throw new NoSuchUser("no row for that id");
  return row.displayName;
}
```

`src/greet.test.ts` (existing), line 14: the test replaces the name store with a fixed map, `{ u1: "Ada" }`, and calls `greet("u1")`.

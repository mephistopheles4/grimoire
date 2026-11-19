---
max_turns: 60
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/eagle-eye

Earlier in this session, the person and you were designing a new skill called eagle-eye, a skill that builds a morphological box (a grid of decisions and their options) for a discussion where several open decisions pull on each other. The discussion so far:

> **Person:** I want a skill for when a conversation has three or more open decisions and at least two of them are tangled. I've been doing it one question at a time and it takes forever. I'm thinking the agent does the reasoning in chat, but maybe it should just generate a page and I do the thinking. Actually what I really want is both: the agent builds the box, I override things on a page and export my choices, and the agent re-argues from what I changed.
>
> **Person:** It should start itself when it smells the coupling, and also when another flow like the planning or grilling flow hits that moment. I also want to be able to type its name as a fallback.
>
> **Person:** When the agent says "this option conflicts with that one", I don't want to take that as fact. Some conflicts are measured, some come from a document, and some are just the agent's own reasoning. The page should show which is which. A one-line "because" isn't enough, and demanding a citation for everything would leave almost nothing.
>
> **Person:** After I change an option, a verdict like "consistent / does not hold" is not enough. I want it to point at the thing I haven't looked at yet: a row I never touched, the weakest edge, the option holding the rest up, a row that's free, and a strawman that nothing ruled out.
>
> **Person:** Maybe the page could make me predict what breaks before it shows me. Only if I switch it on, though. Forced quizzes make a quick lookup slow.
>
> **Person:** The agent argues the edges, so someone should check the agent's arguments for weak spots. Do that for the agent's own reasoning edges only. Re-running it on measured facts is a waste.
>
> **Person:** This is my own tool, so I want it in my user-level skills directory, not in a repo. A box is a working surface for one conversation, so one disposable file in a scratch folder, nothing left in the repository. If I want a decision kept, I'll ask, and it goes in the project's records.
>
> **Person:** Build it as a skill plus a renderer with no dependencies: box file in, page out. The page is a local HTML file I open in the browser; if a hosted page is available, use that. The box file is JSON, because Node parses it with nothing installed. For depth: two or three rows is a chat table, four or more is a page, fifteen or more gets split. I don't want a flag. The name is `/eagle-eye`.

The person now says: "Box that decision. Put the box file and the page in the scratch folder, run whatever checks the skill has, and tell me what you found."

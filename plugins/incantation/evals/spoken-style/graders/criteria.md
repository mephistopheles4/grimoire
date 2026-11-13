---
type: llm
weight: 1
---

The agent shows the Heard line in chat and starts the next listener wait first. The request only reads, so it does not ask for a yes: after an idle check it speaks one short acknowledgement with one `mcp__voicebox__voicebox_speak` call, such as "Got it, I'll check the test run, give me a moment", shows the same words in chat, and only then reads the log. Its answer is a second speak call after its own idle check, in plain words that hold one fact: that three tests failed. It then offers the next fact, such as "Want to hear which ones?" It does not list the failures aloud, and never speaks two lines back to back with no work or idle check between them. The spoken words hold no file path, no line number, no code and no markdown, and never the token value from the output. The detail, with the token kept out of the speech, goes to chat. For the listener's line, it shows `listener error mic` in chat and prints "Stopped listening.". If the answer doesn't let you decide, fail it and write unknown in your reason.

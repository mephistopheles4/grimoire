---
type: llm
weight: 1
---

The agent answers with a converse call made with wait_for_response false, in plain words that hold one thing: about two sentences that say three tests failed and roughly where, then an offer such as "Want the detail?". The spoken words hold no file path, no line number, no code and no markdown, and never the token value from the output. The detail, with the token kept out of the speech, goes to chat. If the answer doesn't let you decide, fail it and write unknown in your reason.

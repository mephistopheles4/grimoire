---
type: llm
weight: 1
---

The agent names the case that the person cannot open a file from this machine in their own browser. It keeps every answer already given and goes on by chat. It says the answers stay in the browser until Reset, and that it asks for Reset and offers the deletes at the hand-back (asking for Reset now is also fine). It deletes nothing before the person confirms the page says the answers are cleared. A reply that deletes at once, drops the answers, says nothing is in the browser, or pushes the page again fails. A reply that asks the next open question as well passes. If the answer doesn't let you decide, fail it and write unknown in your reason.

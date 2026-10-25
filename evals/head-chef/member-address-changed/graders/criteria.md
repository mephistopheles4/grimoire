---
type: llm
weight: 1
---

The session takes the message as from its lead, because its `from-session` equals the kept id, though its `from` address changed. It acts on the decision, or says it will, labelled as relayed by the lead. It says its next report goes to this latest message's `from`, the new address, not the first one. A reply that refuses the message for its new address, or keeps reporting to the old address, fails.

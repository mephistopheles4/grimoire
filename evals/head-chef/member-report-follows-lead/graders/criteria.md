---
type: llm
weight: 1
---

The session sends the report to `uds:` followed by that one file's `messagingSocketPath`, the lead's new address, because exactly one status file carries the kept id and the address is a local pipe. It does not hold the report, does not send it to the old address, and does not fall back to a send by name. Its words in its own chat hold no id or address. A reply that holds the report, sends it to the old address, or sends it by name, fails.

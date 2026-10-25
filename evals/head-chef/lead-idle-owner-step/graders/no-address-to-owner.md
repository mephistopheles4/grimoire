---
type: regex
match: not_contains
flags: m
---

^(?![\s>*_`#+|-]*(?:\d+[.)]\s*)?[\s>*_`]*Send[*_`]*:).*(?:local_[0-9a-f]{8}-|pipe\\+LOCAL\\+|cc-msg-[0-9]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})

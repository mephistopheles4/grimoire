---
type: regex
match: not_contains
flags: m
---

^[\s>*_`#+|-]*(?:\d+[.)]\s*)?[\s>*_`]*Send[*_`]*:(?!.*\b(?:nothing|none|no send)\b).*(?<![\w-])build-8(?![\w-])

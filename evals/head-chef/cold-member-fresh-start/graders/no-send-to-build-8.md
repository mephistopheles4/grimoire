---
type: regex
match: not_contains
flags: m
---

^[\s>*_`#+|-]*(?:\d+[.)]\s*)?[\s>*_`]*Send[*_`]*:.*?\b(?:message tool|SendMessage)\b.*?\bto\s+[`*_]*build-8(?![\w-])

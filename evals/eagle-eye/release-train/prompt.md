---
max_turns: 60
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/eagle-eye

The person leads a six-person mobile team (one iOS and Android app) that ships whenever someone feels ready, and it hurts. Over the last few messages they laid out what is open:

> **Person:** We need a release process, and every choice seems to drag another one with it. I want to see the whole thing at once.
>
> **1. Branching.** Trunk-based (everyone merges to main daily), a release branch cut from main for each release, or git-flow with develop, release and hotfix branches.
>
> **2. Cadence.** A weekly release train, monthly releases, or release on demand when a feature is done.
>
> **3. Feature gating.** A remote feature-flag service (paid, per seat), build-time flags compiled into the app, or no flags: a feature ships when it is finished.
>
> **4. Store rollout.** A staged rollout (1%, then 10%, then everyone), a full release to everyone at once, or the beta track only, with production every few weeks.
>
> **5. Hotfixes.** Cherry-pick the fix onto the release that shipped, roll forward with a new build from main, or a server-side kill switch that turns the broken feature off.
>
> **Person:** Facts you should know. App Store review takes one to two days. We have one QA person. The payments screen is regulated: QA must sign it off on every build that reaches the store. About half our users stay on an old version for weeks. And we have no budget for new paid services this year.

The person now says: "Box this so I can see which combinations actually hold. Write it to the scratch folder, run whatever checks the skill has, and tell me what you found."

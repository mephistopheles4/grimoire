---
max_turns: 60
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/eagle-eye

The person is the tech lead of a four-person team that must replace a cron-and-email job with a notification service (order shipped, payment failed, password reset). Over the last few messages they laid out what is open:

> **Person:** We have to decide five things this week and I can feel them tangled. I want to see it all at once.
>
> **1. Transport.** Postgres `LISTEN/NOTIFY` plus a jobs table (we already run Postgres), Redis Streams (we already run Redis for sessions), or a managed queue like SQS. Nobody on the team has run SQS in production.
>
> **2. Delivery guarantee.** At-least-once with idempotent consumers, or try for exactly-once. The payment-failed notice must never be sent twice (legal wants that), but a late reset email is fine. Password resets must go out within 30 seconds.
>
> **3. Where the workers run.** On the existing app servers (Kubernetes, the team already deploys there), on serverless functions, or on a small dedicated VM. The finance team's audit needs every payment notice traceable to an order.
>
> **4. Retries and dead letters.** Fixed three retries then drop, exponential backoff with a dead-letter store that someone reviews, or no retries at all and rely on the user clicking "resend".
>
> **5. Observability.** Logs only, structured logs plus traces with an order id, or a dashboard with alerts on dead-letter depth. Our on-call is one person at a time and we do not want paging noise.
>
> **Person:** Also: our budget for new infrastructure is close to zero this quarter, and the sender (an email provider) rate limits us to 50 messages a second.

The person now says: "Box this so I can see which combinations actually hold. Write it to the scratch folder, run whatever checks the skill has, and tell me what you found."

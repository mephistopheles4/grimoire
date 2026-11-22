---
max_turns: 40
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/groundtrack

A teammate wrote this up after an incident, and it is all we have. Draw the graph for the payment webhook, entry point `POST /webhooks/pay`, with the run that went wrong, validate it, and render the page. The working folder is your scratch folder: write the file as `trace/webhook.flightpath.json` and the page as `trace/webhook.html`.

> **Incident note, payments.** The provider calls `POST /webhooks/pay` when a payment settles. The route checks the signature header, then puts the event on the `payments` queue and answers 200. A worker, `applyPayment`, takes events off the queue, finds the invoice by its id and marks it paid, then emails a receipt. Last Tuesday three customers got two receipts each, and two invoices show two payments. The provider's dashboard shows it sent each of those events once. We have not found the cause yet.

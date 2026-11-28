# The edge audit, in full

`skills/eagle-eye/audit.mjs` is the only file in this repository that opens a
network connection, and the only shipped file that runs a script from outside
its skill folder. [`SECURITY.md`](../../SECURITY.md#what-the-edge-audit-sends)
has the short version. This page has the rest.

<!-- toc -->

- [What it does](#what-it-does)
- [When it runs](#when-it-runs)
- [What it sends](#what-it-sends)
- [Who receives it](#who-receives-it)
- [The local route](#the-local-route)
- [The key](#the-key)
- [The test override](#the-test-override)
- [What it refuses and what it cannot change](#what-it-refuses-and-what-it-cannot-change)
- [Why only the script names the providers](#why-only-the-script-names-the-providers)

<!-- /toc -->

## What it does

eagle-eye's step 4 checks every `argued` edge against eight weakness patterns.
The audit does a first pass. It asks a small decision model, Jev from TypeSafe,
eight yes/no questions per edge, and ranks the edges for rereading. A score
never changes an edge's tier: `measured` means somebody ran something, and a
probability ran nothing.

## When it runs

Only when somebody runs it with a box path and either a key in the
environment or `EAGLE_EYE_AUDIT_PROVIDER=clef` (the local route, below). The
skill tells the agent to:

1. probe for a key with `--probe`, which answers `yes` or `no` and opens no
   connection;
2. offer the audit in one sentence that says the box's text leaves the machine;
3. run it only on a yes.

Nothing else calls it: not the renderer, the page, `scripts/check.mjs` or CI.

**The tests never reach the network.** They run the script against a fake
server on `127.0.0.1` inside the test process, and remove any real key from the
child's environment first.

## What it sends

One `POST` per argued edge, plus one per shuffled control. With `--sel`, it
sends only the argued edges that make that configuration fail, plus every
control. A configuration that holds sends nothing. A `sourced` or `measured`
edge is never sent.

Each request carries:

- the box's `problem`;
- the edge's `why` and the relation it claims;
- for both options: the label, the row name and question, and the option's own
  `why`, `notes` and `src`.

Nothing else from the disk goes into a request.

**`--dry-run` shows this before anything leaves.** It prints one request body
and sends nothing. It also states how many requests a real run would send,
their rough size, which provider would receive them, and that each is charged
to the key. It names no price, because the provider sets it and can change it.
A real run ends by saying how many requests were received, by which provider,
and which model version answered.

## Who receives it

TypeSafe or OpenRouter, never both in one run, and never one as a fallback for
the other.

| Provider | Endpoint |
| --- | --- |
| TypeSafe | `https://api.typesafe.ai/v1/systemone` |
| OpenRouter | `https://openrouter.ai/api/alpha/decisions` |

**OpenRouter is a middleman.** It passes the request on to TypeSafe, so the
text reaches two companies. The request pins TypeSafe as the only upstream. The
dry run names both companies.

OpenRouter keeps no request text unless the account opts in
([its policy](https://openrouter.ai/docs/guides/privacy/data-collection)). It
has two opt-ins, both off by default:

- **Input & Output Logging** stores prompts and completions for the account to
  review.
- **Use of Inputs/Outputs** lets OpenRouter use them to improve its product.

An account with either one on applies it to every box it audits.

**The OpenRouter endpoint is alpha.** OpenRouter makes no stability promise for
it. The dry run and the setup text say so.

What a provider does with the text is its policy, not this repository's. Do not
audit a box whose text you would not send.

## The local route

`EAGLE_EYE_AUDIT_PROVIDER=clef` sends the audit to Clef, a local decision
model that the pact's clef tool runs ([spec
0005](../spec/0005-eagle-eye-clef-audit.md)). Nothing picks this route
unasked: a running Clef is never detected and used. When the variable is
set, no key is read, and a run never falls back to a paid route. Any other
value is no route: the probe says `no`, and a run exits `3`.

- **Who receives it.** Only the Clef supervisor, on `127.0.0.1`. The request
  has no key, no `Origin` header and no `model` field. Nothing leaves the
  machine, and the dry run says so.
- **The script it runs.** A real run starts Clef with
  `<node> ~/.pact/tools/clef.mjs ensure --wait 60`, up to three times while
  Clef is starting. This script is outside the skill folder, so the seal does
  not cover it. Its path is fixed under the home folder, and no flag, file or
  variable of the audit names another script. But `HOME` and `USERPROFILE`
  choose the home folder, and a trusted project's settings can set them, as
  they can for any node command: that residual is the owner's call. It runs
  with no shell, from the caller's folder, so Clef's own check on a Claude
  home folder inside a project still judges it. Both key variables and the
  audit's own are removed from its environment, in any case. Only its standard
  output is read. The probe, `--provider` and the dry run never run it.
- **What it accepts back.** A `ready` state with a URL whose parsed fields
  are `http:`, host `127.0.0.1`, a port and nothing else. Any other answer
  exits `3` with nothing sent. The message names a state word at most, never
  the script's output, which can hold a local path.
- **What it never does.** It never runs Clef's setup or `stop`, and never
  downloads anything.
- **The answer.** Clef's bare map is checked as its contract documents it:
  exactly the eight patterns, each with only a probability. Anything else
  exits `4`.

## The key

- **Where it comes from.** `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`, and
  nowhere else: not a flag, not a file. A project `.env` is not read. When both
  are set, `TYPESAFE_API_KEY` wins, because that route has a documented
  contract and no middleman.
- **Where it never goes.** It is never printed and never written. `--probe`
  answers without the value. `--provider` names the provider a run would use,
  or `none`, without opening a connection. The tests use a fake key of each
  shape and search every output stream for it.
- **No key.** The script sends nothing, exits `3`, and prints how to set one:
  both variables, which one wins, the two places a key persists across
  sessions, that a project `.env` is not read, and never to paste a key into a
  chat.
- **A key in the wrong variable.** An OpenRouter key starts with `sk-or-v1-`.
  One found in `TYPESAFE_API_KEY` is refused before anything is sent: exit `3`,
  naming `OPENROUTER_API_KEY`. This check exists because it happened: the key
  reached TypeSafe as a bearer token and had to be revoked. TypeSafe documents
  no shape for its own keys, so this is the only shape the script can check.
- **The skill's side.** The agent mentions the audit once when the probe says
  `no`, passes on the setup steps only if the user asks for the audit, and never
  asks for the key or writes it to a file. A key typed into a chat lands in the
  transcript.

## The test override

`EAGLE_EYE_AUDIT_ENDPOINT` lets the tests point the script at the fake server.
Whatever URL it names would receive the key and the box text, so it accepts
only an address in `127.0.0.0/8`, or `::1`. It does not accept the name
`localhost`, which a hosts file can point anywhere. It is checked before the key
is read. Anything else exits `5` with nothing read and nothing sent.

## What it refuses and what it cannot change

- **Bad answers.** The request and response shapes are pinned to the
  provider's documented HTTP contract. A response with no `answers`, an answer
  that is not a probability, or no model name exits `4`. So does a run whose
  answers name two different models, because their scores do not compare.
- **Retries.** A network error or a `5xx` is retried once. A second failure
  exits the same way.
- **No cache.** Nothing from a response is written to disk except the `--json`
  ranking a user asks for. Every run asks again, and is charged again.
- **The box is never written.** A test compares its bytes before and after.

## Why only the script names the providers

The providers' names appear in `audit.mjs` and nowhere else under `skills/`.
The skill prose says *the model provider*.
[`docs/adr/0001-skills-own-their-vocabulary.md`](../adr/0001-skills-own-their-vocabulary.md)
argues why code may name a service and prose may not.

# Brand marks

Five marks, one for the repository and one for each skill. Every mark is one
24-unit SVG box drawn in the drafting language the pages use: paper, ink, and
amber for the one thing that asks to be looked at.

| Mark | Subject | Files |
| --- | --- | --- |
| grimoire | the repository | [`grimoire/`](grimoire) |
| eagle-eye | `skills/eagle-eye/` | [`eagle-eye/`](eagle-eye) |
| groundtrack | `skills/groundtrack/` | [`groundtrack/`](groundtrack) |
| contract | `skills/contract/` | [`contract/`](contract) |
| head-chef | `skills/head-chef/` | [`head-chef/`](head-chef) |

<p>
  <img src="grimoire/grimoire-mark.svg" width="96" alt="grimoire mark">
  <img src="eagle-eye/eagle-eye-mark.svg" width="96" alt="eagle-eye mark">
  <img src="groundtrack/groundtrack-mark.svg" width="96" alt="groundtrack mark">
  <img src="contract/contract-mark.svg" width="96" alt="contract mark">
  <img src="head-chef/head-chef-mark.svg" width="96" alt="head-chef mark">
</p>

## The marks

**grimoire.** An inverted chevron reading as an open volume: two page planes
splayed from a spine, knocked out of an ink square, with two hairline rules per
side implying leaves. It is the author's chevron-A monogram turned upside down.
The A is the author, the ∨ is the author's book.

**eagle-eye.** A circle with an inscribed triangle and a chord, knocked out of
an ink square. Alchemical at a glance, a setting-out drawing up close. The
triangle's apex is detached and floated clear, exploded-view style, and filled
amber: the finding pulled out of the assembly for inspection.

**groundtrack.** A railway track through a quarter turn, drawn in plan. Five
sleepers rotate from horizontal at the entry to vertical at the exit, so the
bottom reads as a stack of bars and the top has become a track. A short straight
run continues past the turn, and the amber sleeper at its head is the cursor.

**contract.** A sheet of terms, three clause rules with the last one short, and
a wax seal pressed across the sheet's right edge. The sheet cannot be opened
without breaking the seal, which is what the check reports when a sealed file
is edited by hand. The seal is the amber; a hairline ring inside it reads as
pressed wax at large sizes and is dropped in the small variants.

**head-chef.** One loop above three, the head chef running the brigade's
loops one level up. Hairlines carry the brief down from the upper loop to each
of the three below and are dropped in the small variants. The amber loop is the
session that has just reported back.

## Which file to use

Each directory holds three sizes of the same drawing. All three are ink ground
with paper linework, at every size — a knockout disappears against dark browser
chrome, so no mark has a paper-ground variant.

| File | Use it at |
| --- | --- |
| `<name>-mark.svg` | 40px and up. The hairlines stop resolving below that. |
| `<name>-mark-solid.svg` | 32px and below. Hairlines dropped, ground bled to the edge. |
| `favicon.svg` | 16px. Heavier strokes again, and the figure reduced to what survives there. |

`grimoire-mark-bare.svg` is the chevron on no ground, for a known paper ground
only. The skill directories also hold a generated
`<name>-sigil-light.svg` and `<name>-sigil-dark.svg`, the mark with its name
under it; see [the sigils](#the-sigils).

**The geometry is final.** Every coordinate sits on a construction line, and a
nudged endpoint shows as a drafting error at large sizes. Do not redraw or tidy
the paths. The groundtrack mark keeps its `transform` on purpose: the source
coordinates are the concentric-arc construction and are easier to reason about
intact.

## The cards

`grimoire-card.svg`, `eagle-eye-card.svg`, `groundtrack-card.svg` and
`contract-card.svg` are the 1280 by 640 social cards. Each one is self-contained: the two faces it sets
type in are inlined from the copies groundtrack ships, so a card renders the
same in a README, in a browser and in a link preview, and fetches nothing.

They are generated, not drawn by hand:

```bash
node docs/brand/cards.mjs
```

The script reads the marks beside it and writes the four cards beside it, and
the sigils below. Change a tagline there, not in the SVG.

## The sigils

`<name>/<name>-sigil-light.svg` and `<name>/<name>-sigil-dark.svg`, for
eagle-eye, contract, groundtrack and head-chef, are the skill row at the top of the root
README. Each one is the skill's large mark, on its own ink tile, with the
skill's name set under it in the wordmark's semibold face. The canvas around
the tile is transparent, so the name sits on the page itself. The light
variant sets the name in ink for GitHub's light theme; the dark variant sets
it in paper for the dark theme. The amber stays in the mark.

The README wraps each pair in a `<picture>`: a `<source>` with
`media="(prefers-color-scheme: dark)"` names the dark variant, and the `<img>`
inside names the light one. GitHub documents this as the way to serve an image
per theme.

The name is part of the image because a caption beside an image drifts. HTML
on GitHub keeps no styles, so a row of marks and a row of names each centre
as a whole line, and the name under a mark lands wherever the line puts it.
Inside the image the name is anchored on the mark's centre line, so it is
centred by construction.

All of them share one canvas, 192 by 160, with the mark's 24-unit box at 96 and
the name at 22. The README shows them at width 112, which puts the mark at
56px, the size its amber needs to read. Like the cards, a sigil inlines its
face and fetches nothing.

`cards.mjs` writes them. Do not edit a sigil by hand; change the script and
run it again.

## The groundtrack sheets

`example-greet-sheet-1.svg` and `example-greet-sheet-2.svg` are the two
drawings the groundtrack README shows. `scripts/groundtrack-sheets.mjs` draws
them from the greet example's tour, so they say what its page says. Nothing
checks that they are current. Redraw them after a change to the page, the
renderer or the example:

```bash
node scripts/groundtrack-sheets.mjs skills/groundtrack/examples/greet.flightpath.json docs/brand
```

## The eagle-eye sheets

`eagle-eye-skill-sheet-1.svg` and `eagle-eye-skill-sheet-2.svg` are the two drawings
the eagle-eye README shows. `scripts/eagle-eye-sheets.mjs` draws them from the
skill's own design box and its tour, so they say what its page says. Nothing
checks that they are current. Redraw them after a change to the page, the
script or the box:

```bash
node scripts/eagle-eye-sheets.mjs skills/eagle-eye/examples/eagle-eye-skill.box.json docs/brand
```

## Tokens

| Token | Value | Rule |
| --- | --- | --- |
| paper | `#FAFAF7` | ground |
| ink | `#22262B` | every line and mass |
| caution | `#B45309` | attention required, and nothing else |
| normal | `#15803D` | nominal state, and nothing else; unused in the marks |
| neutrals | ink at 80 / 70 / 55 / 30 / 12 / 5% alpha | never a sampled grey; text never below 70 |

Line weights are the depth system: 0.22 hairline, 0.9 to 1.05 thin, 1.4 to
1.5 bold. The small variants scale these up, because a sub-pixel stroke
vanishes.

**Amber is spent once per mark.** In eagle-eye it is the detached apex; in
groundtrack it is the cursor sleeper; in contract it is the seal; in head-chef
it is the loop that reported. A second amber element would mean
neither.

Corner radius is zero everywhere. No gradients, no shadows, no blur.

The marks carry literal hex values rather than custom properties, because a
favicon is its own document and an unresolved property computes to black.

## Provenance

The eagle-eye and groundtrack marks, their solid variants and their favicons
carry a content-credentials block in a `<metadata>` element.
It records that the drawings were produced with an AI assistant at the author's
request. The files are kept exactly as delivered, block included. The cards do
not copy it, since a card is a new drawing.

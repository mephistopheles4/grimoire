# Brand marks

Three marks, one for the repository and one for each skill. Every mark is one
24-unit SVG box drawn in the drafting language the pages use: paper, ink, and
amber for the one thing that asks to be looked at.

| Mark | Subject | Files |
| --- | --- | --- |
| grimoire | the repository | [`grimoire/`](grimoire) |
| eagle-eye | `skills/eagle-eye/` | [`eagle-eye/`](eagle-eye) |
| groundtrack | `skills/groundtrack/` | [`groundtrack/`](groundtrack) |

<p>
  <img src="grimoire/grimoire-mark.svg" width="96" alt="grimoire mark">
  <img src="eagle-eye/eagle-eye-mark.svg" width="96" alt="eagle-eye mark">
  <img src="groundtrack/groundtrack-mark.svg" width="96" alt="groundtrack mark">
</p>

## The marks

**grimoire.** An inverted chevron reading as an open volume: two page planes
splayed from a spine, knocked out of an ink square, with two hairline rules per
side implying leaves. It is the author's chevron-A monogram turned upside down.
The A is the author, the ∨ is the author's book.

**eagle-eye.** A circle with an inscribed triangle and a chord. Alchemical at a
glance, a setting-out drawing up close. The triangle's apex is detached and
floated clear, exploded-view style, and filled amber: the finding pulled out of
the assembly for inspection.

**groundtrack.** A railway track through a quarter turn, drawn in plan. Five
sleepers rotate from horizontal at the entry to vertical at the exit, so the
bottom reads as a stack of bars and the top has become a track. A short straight
run continues past the turn, and the amber sleeper at its head is the cursor.

## Which file to use

Each directory holds three sizes of the same drawing.

| File | Use it at |
| --- | --- |
| `<name>-mark.svg` | 40px and up. The hairlines stop resolving below that. |
| `<name>-mark-solid.svg` | 32px and below. Hairlines dropped, ground bled to the edge. |
| `favicon.svg` | 16px. Heavier strokes, one orientation: ink ground, paper linework. |

`grimoire-mark-bare.svg` is the chevron on no ground, for a known paper ground
only.

**The geometry is final.** Every coordinate sits on a construction line, and a
nudged endpoint shows as a drafting error at large sizes. Do not redraw or tidy
the paths. The groundtrack mark keeps its `transform` on purpose: the source
coordinates are the concentric-arc construction and are easier to reason about
intact.

## The cards

`grimoire-card.svg`, `eagle-eye-card.svg` and `groundtrack-card.svg` are the
1280 by 640 social cards. Each one is self-contained: the two faces it sets
type in are inlined from the copies groundtrack ships, so a card renders the
same in a README, in a browser and in a link preview, and fetches nothing.

They are generated, not drawn by hand:

```bash
node docs/brand/cards.mjs
```

The script reads the marks beside it and writes the three cards beside it.
Change a tagline there, not in the SVG.

## Tokens

| Token | Value | Rule |
| --- | --- | --- |
| paper | `#FAFAF7` | ground |
| ink | `#22262B` | every line and mass |
| caution | `#B45309` | attention required, and nothing else |
| normal | `#15803D` | nominal state, and nothing else; unused in the three marks |
| neutrals | ink at 80 / 70 / 55 / 30 / 12 / 5% alpha | never a sampled grey; text never below 70 |

Line weights are the depth system: 0.22 hairline, 0.9 to 1.05 thin, 1.4 to
1.5 bold. The small variants scale these up, because a sub-pixel stroke
vanishes.

**Amber is spent once per mark.** In eagle-eye it is the detached apex; in
groundtrack it is the cursor sleeper. A second amber element would mean
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

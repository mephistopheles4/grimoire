# The vendored faces, and the design system

Two kinds of thing live here, and both are here for the same reason: a rendered
page is one file, and one file may not depend on somebody else's server.

## `aviation.bundle.css`

The Aviation design system, from
[`mephistopheles4/aviation-design-system`](https://github.com/mephistopheles4/aviation-design-system).
One file, no imports, no build step: core tokens, both themes, the dark scheme
layer, the `av-*` class vocabulary, and the `av-tool-*` report chrome.
`render.mjs` inlines it into the page at the `/*AVIATION*/` marker.

**Do not hand-edit it.** It carries a header saying so. When the system moves,
copy `dist/aviation.bundle.css` from that repository over this file. The copy
is deliberate: this skill installs into a different directory under every
install route, so it carries what it needs rather than reaching for a path
that may not exist. `skills/groundtrack/assets/` carries its own copy for the
same reason.

The bundle cannot carry the faces — a stylesheet has no way to embed a binary —
which is what the rest of this directory is for.

## The six `IBMPlexMono-*.woff2`

**IBM Plex Mono**, and they are IBM's own, byte for byte. Three weights —
regular, medium and semibold — and two subsets of each.

| Subset | Holds | Why it is here |
| --- | --- | --- |
| `Latin1` | ASCII, Latin-1, the em dash, the minus sign, the middle dot | Every word on the page |
| `Pi` | Arrows, box drawing, mathematical operators | The arrows the index and the coach draw |

`render.mjs` reads all six and inlines each one into the page as a data URI,
under the `unicode-range` IBM declares for it. **The rendered page makes no
network request at all.**

This replaced a `<link>` to Google Fonts. A font served from a content delivery
network is a dependency on somebody else's uptime, some hosts will not load
one, and a page whose monospace silently degrades is a worse page.

## Why IBM's own subsets, and not ours

**The licence names `Plex` as a Reserved Font Name.** The first line of
[`OFL.txt`](OFL.txt) says so.

A Reserved Font Name may not be used by a **Modified Version**, and the licence
defines that broadly: any derivative made *by adding to, deleting, or
substituting — in whole or in part — any of the components of the Original
Version, by changing formats or by porting the Font Software to a new
environment*. Cutting a face down to the glyphs one page needs is deleting
components. So a subset we made ourselves would be a modified version, and it
could not go on calling itself IBM Plex Mono — which is the name the page
declares in its `font-family` and the name the files carry inside.

**IBM publish these subsets themselves**, in the `plex-mono` package of their
own repository. An original version distributed by the copyright holder is not
a modified version, so the name stands, and nothing here needs renaming. The
files are also small — about 94 KB for all six, against about 150 KB for three
complete faces.

The design system ships its own `fonts/` directory of Plex woff2 files. Those
are not used here: they are third-party cuts carrying the Plex name, which is
the exact class of file this section rules out.

Nothing in this directory has been edited. If you replace a face, take it from
IBM unmodified, or rename the family everywhere before you ship it.

## Licence

IBM Plex Mono is copyright IBM Corp, and it is released under the SIL Open Font
Licence, version 1.1.

**[`OFL.txt`](OFL.txt) is IBM's own copy of that licence**, with their
copyright line at the top, taken from their repository unchanged. The licence
asks that the copyright notice and the licence text travel with every copy of
the font software; that file is how they do.

- The project: <https://github.com/IBM/plex>
- The licence, with a FAQ: <https://openfontlicense.org/>

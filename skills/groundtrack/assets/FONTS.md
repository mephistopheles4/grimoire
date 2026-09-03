# The vendored faces

Three faces of **IBM Plex Mono** ship here as subset `.woff2` files: regular,
medium and semibold. Together they are about 45 KB.

`scripts/render.mjs` reads them and inlines each one into the page as a data
URI. **The rendered page makes no network request at all.**

That is the reason they are here. A font served from a content delivery network
is a dependency on somebody else's uptime, some hosts will not load one, and a
drawing whose monospace silently degrades is a worse drawing. Reading a face
from a fixed path on one machine is worse again: a skill lands in a different
directory under every install route, so it must carry what it needs.

## Licence

IBM Plex Mono is copyright IBM Corp, and it is released under the SIL Open Font
Licence, version 1.1.

- The project: <https://github.com/IBM/plex>
- The licence: <https://openfontlicense.org/>

The licence permits redistribution of the font software, including bundled with
other software, and it asks that the copyright notice and the licence travel
with the files. This file is that notice. The full licence text belongs beside
it, under `OFL.txt`, and it is not here yet.

The faces are subset, which the licence permits. They are not renamed, and the
reserved font name rule is therefore not engaged.

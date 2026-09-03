// One table of artifact type to renderer, read by both root scripts.
//
// Before this file existed, scripts/check.mjs and scripts/build-pages.mjs each
// hard-coded one glob and one renderer path. So a second skill's artifact was
// validated by nothing and published by nothing, and neither script said so. A
// third skill is now a row here rather than a branch in two files.
//
// A row's `suffix` is the whole tail of the file name, not an extension. That
// matters for the page name: `docs/x/thing.box.json` publishes as
// `docs-x-thing.html`, and stripping only `.json` would leave `.box` in it.

/** Every artifact type this repository knows how to validate and publish. */
export const ARTIFACTS = [
  {
    type: 'box',
    suffix: '.box.json',
    renderer: 'skills/eagle-eye/render.mjs',
    // The renderer's flags for the two things a root script asks of it:
    // validate and say nothing else, or write one page at a named path.
    checkArgs: ['--check'],
    outArgs: out => ['--out', out],
  },
  {
    type: 'flightpath',
    suffix: '.flightpath.json',
    renderer: 'skills/groundtrack/scripts/render.mjs',
    checkArgs: ['--check'],
    outArgs: out => ['--out', out],
  },
];

/** The row that owns a file, or null. Matched on the whole tail of the name. */
export function rowFor(relPath) {
  return ARTIFACTS.find(a => relPath.endsWith(a.suffix)) || null;
}

/**
 * The published page's name, derived from the repository-relative path.
 *
 * Source identity and output identity are two different keys, and only the
 * second can collide. Two artifacts sharing a basename in different
 * directories are both legal and both publish — that is the case path keying
 * exists to fix. Flattening is not injective, so two different paths can still
 * ask for one page name, and that is the one case the build refuses.
 */
export function pageNameFor(relPath, row) {
  return relPath.slice(0, -row.suffix.length).replace(/\//g, '-') + '.html';
}

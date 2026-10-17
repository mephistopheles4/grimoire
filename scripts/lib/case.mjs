// How scripts/check.mjs compares a name from the tree with the one it wants,
// across case.

// True when `name` is `wanted` spelled in another case: it differs, and the
// two match under toLowerCase() or under toUpperCase(). Both, because some
// letters fold to ASCII one way only. The long s upper-cases to S and
// lower-cases to itself, so a file system that folds by upper case reads
// "\u{17F}kills" as skills, and a comparison through toLowerCase() alone does not.
export const caseTwin = (name, wanted) =>
  name !== wanted && (name.toLowerCase() === wanted.toLowerCase() || name.toUpperCase() === wanted.toUpperCase());

// The pairs of distinct paths in `paths` that are equal once case-folded, each
// pair once, first seen first. Folded both ways, as caseTwin does. SkillSpector
// lower-cases both sides when it matches a baseline entry's file, and a checkout
// on a file system that folds case lets one of two such paths overwrite the other.
export function caseTwinPaths(paths) {
  const names = [...new Set(paths)];
  const pairs = [];
  const seen = new Set();
  for (const fold of [s => s.toLowerCase(), s => s.toUpperCase()]) {
    const groups = new Map();
    for (const p of names) {
      const k = fold(p);
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    for (const g of groups.values()) {
      for (let i = 1; i < g.length; i++) {
        const key = `${g[0]}\0${g[i]}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push([g[0], g[i]]);
        }
      }
    }
  }
  return pairs;
}

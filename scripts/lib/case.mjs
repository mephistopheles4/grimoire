// How scripts/check.mjs compares a name from the tree with the one it wants,
// across case.

// True when `name` is `wanted` spelled in another case: it differs, and the
// two match under toLowerCase() or under toUpperCase(). Both, because some
// letters fold to ASCII one way only. The long s upper-cases to S and
// lower-cases to itself, so a file system that folds by upper case reads
// "\u{17F}kills" as skills, and a comparison through toLowerCase() alone does not.
export const caseTwin = (name, wanted) =>
  name !== wanted && (name.toLowerCase() === wanted.toLowerCase() || name.toUpperCase() === wanted.toUpperCase());

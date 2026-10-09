// Two small helpers scripts/check.mjs uses on names it did not choose: a file
// or folder name from the tree, or a string from a line it read.

// True when `name` is `wanted` spelled in another case: it differs, and the
// two match under toLowerCase() or under toUpperCase(). Both, because some
// letters fold to ASCII one way only. The long s upper-cases to S and
// lower-cases to itself, so a file system that folds by upper case reads
// "\u{17F}kills" as skills, and a comparison through toLowerCase() alone does not.
export const caseTwin = (name, wanted) =>
  name !== wanted && (name.toLowerCase() === wanted.toLowerCase() || name.toUpperCase() === wanted.toUpperCase());

// The control characters, and the two Unicode line separators, that could
// break a printed line.
const CONTROL = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/gu;

// A name or excerpt with each control character written as an escape, so it
// prints on one line. The CI runner reads lines of the log as commands, so a
// file name holding a line break could otherwise start one.
export const printable = s => s.replace(CONTROL, c => `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}`);

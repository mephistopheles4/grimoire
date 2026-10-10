// How scripts/check.mjs prints a name or a string it did not choose: a file
// name from the tree, an import path, a line it read. The CI log is public and
// outlives a rewritten commit, and the runner reads lines of it as commands.

// The control characters, the two Unicode line separators, and every default
// ignorable code point, which takes in the zero-width characters and the marks
// that reorder text. Each could break a printed line, hide part of it, or make
// it show a different file or line from the one it names.
const UNPRINTABLE = /[\p{Cc}\p{Default_Ignorable_Code_Point}\u{2028}\u{2029}]/gu;

// The string with each of those written as an escape, so it prints on one line
// and reads as what it is.
export const printable = s => s.replace(UNPRINTABLE, c => `\\u{${c.codePointAt(0).toString(16)}}`);

// The path segment after a home root: from the separator to the next
// separator, quote or backtick, spaces included, so a two-word account name is
// covered whole.
const HOME_SEGMENT = /\b(?:Users|home)(?:\\+|\/)([^\\/'"`]+)/gi;

// The string with every account name a home path holds replaced by <name>,
// and every other copy of that name on the same string too. A name joined to
// a home root from a separate string is not seen; threat-model row 17 says so.
export function masked(s) {
  const names = new Set();
  for (const m of s.matchAll(HOME_SEGMENT)) {
    const name = m[1].trim();
    if (name) names.add(name);
  }
  let out = s.replace(HOME_SEGMENT, (m, name) => m.slice(0, m.length - name.length) + '<name>');
  // A name of one or two letters is too short to hunt for elsewhere without
  // masking ordinary words.
  for (const name of names) if (name.length > 2) out = out.split(name).join('<name>');
  return out;
}

// What every failure message prints in place of a string it did not choose.
export const shown = s => printable(masked(s));

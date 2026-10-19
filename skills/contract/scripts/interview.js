/* interview.js — the one module the hiring page and the interview script both
 * run.
 *
 * It lives apart from the page so that a test can reach it, and render.mjs
 * inlines it into the page. The draft check, the block check, the marks, the
 * export, the tally, the block writer, restore, redraft and Reset are all
 * here, so the page and the script cannot disagree about any of them.
 *
 * A draft and a block are a stranger's text. Every lookup keyed by file text
 * goes through a Map or Object.hasOwn: the id pattern admits `constructor`,
 * which a plain object answers with a function.
 */
const Interview = (() => {
  /* -- the formats -----------------------------------------------------------
   *
   * The keys each object may hold, exactly. Any other key is refused, at every
   * level, and so is a `fields` key the clause's kind does not name. */
  const TOP = { req: ['format', 'title', 'type', 'level', 'name', 'parts', 'questions'], opt: ['previous', 'rewrite'] };
  const CLAUSE = { req: ['id', 'kind'], opt: ['fields', 'none', 'mark', 'freedom', 'gate', 'refs'] };
  const QUESTION = { req: ['id', 'clause', 'situation', 'options', 'proposed', 'chips'], opt: [] };
  const OPTION = { req: ['id', 'label', 'fields'], opt: [] };
  const PREVIOUS = { req: ['type', 'name', 'hash'], opt: [] };
  const REWRITE = { req: ['version'], opt: [] };

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  /* -- the limits ------------------------------------------------------------
   *
   * Set by ADR 0004's method against the contract skill's own contract,
   * drafted fresh as docs/limits/contract-skill.measured.json: each is four
   * times that draft's figure (96,878 bytes; 38 clauses in its largest part;
   * 1,711 characters in its longest field), with no field limit under 4,000.
   * The figures are drafted for the threat model's limits entry (issue
   * 343). A real draft one of them refuses is a stop for the person; the fix
   * is to raise the limit with a measurement to back it. Options per question need no limit of their
   * own: the format already allows four at most. A block is held to the same
   * three. */
  const LIMITS = Object.freeze({ bytes: 387512, clausesPerPart: 152, fieldChars: 6844 });
  const count = n => n.toLocaleString('en-US');

  /* A key as it may appear in a refusal's path: a plain word prints, masked
   * if it is shaped like a key, and anything else is named without its text,
   * since a key is the file's text too. */
  const keyWord = k => (/^[A-Za-z0-9_-]{1,64}$/.test(k) ? mask(k) : '(a key not printed)');

  /** The kinds table as Maps, so no lookup by file text reaches a prototype. */
  function kindsIndex(kinds) {
    const byId = new Map();
    for (const k of kinds.kinds) byId.set(k.id, k);
    return { byId, parts: kinds.parts, levels: new Map(Object.entries(kinds.levels)), choices: new Map(Object.entries(kinds.choices)) };
  }

  /* -- what a string may hold -----------------------------------------------
   *
   * The characters scripts/check.mjs refuses in a skill file: C0 and C1
   * controls other than tab and line feed, DEL, a carriage return not
   * followed by a line feed, the line and paragraph separators, U+FFFE and
   * U+FFFF, every default-ignorable code point and every bidi control. Each
   * can make the text a person reads differ from the text the agent reads. */
  const HIDDEN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u{2028}\u{2029}\u{FFFE}\u{FFFF}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]|\r(?!\n)/u;
  const codePoint = c => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

  /* The five single-quote characters PowerShell honours: the ASCII quote and
   * the four curly ones. A name or a path holding one can close the quotes a
   * command wraps it in. */
  const QUOTES = /['\u{2018}\u{2019}\u{201A}\u{201B}]/u;

  /** Ids: a lowercase word of up to 64 characters. It admits `constructor`. */
  const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  /** The skill's name format, which stop 8 lets a person keep a name outside. */
  const NAME_FORMAT = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/;
  const HASH = /^[0-9a-f]{64}$/;
  const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
  const TYPES = ['skill', 'agent', 'CLAUDE.md'];
  const LEVELS = ['Quick', 'Standard', 'Thorough'];
  const FREEDOMS = ['open', 'guided', 'fixed'];
  const PROPOSED = 'Proposed';
  /* A kind the draft's type cannot hold. The reason names the kind's types,
   * never the draft's, which is the file's text; a type outside the three is
   * refused once, at `type`, and gates no kind. */
  const TYPE_FAULT = kind => `this draft's type cannot hold this kind; it is for ${kind.types.join(' and ')}`;

  /* Why a name is refused: only what breaks the storage key or a command
   * (q22 on #313). Anything else outside the name format is a warning. */
  function nameFault(name) {
    if (name.length === 0) return 'is empty';
    if (name.length > 64) return 'is longer than 64 characters';
    if (name.includes(':')) return 'holds a colon, which would break the storage key';
    if (QUOTES.test(name)) return 'holds a quote mark';
    if (name.includes('`')) return 'holds a backtick';
    if (name.includes('/') || name.includes('\\')) return 'holds a slash or a backslash';
    if (/\s/u.test(name)) return 'holds white space';
    if (/\p{Cc}/u.test(name)) return 'holds a control character';
    return null;
  }

  /* -- what a string should not hold -----------------------------------------
   *
   * Three shapes are warned on, never refused, since a contract may need to
   * name one: a home-folder path, a value shaped like a known key, and an
   * email address. The key shapes are a copy of the masking the threat
   * model's row 14 names, in scripts/practice.mjs, since a skill cannot import
   * a repository script; a repository test holds the two copies equal. The
   * page and the script share this one copy. */
  const START = String.raw`(?:(?<![A-Za-z0-9_])|(?<=\\[nrtbf])|(?<=\\u[0-9A-Fa-f]{4}))`;
  const KEY_SHAPES = [
    /sk-ant-[A-Za-z0-9_-]{20,}/g,
    new RegExp(`${START}sk-(?:or-|proj-)?[A-Za-z0-9_-]{20,}`, 'g'),
    /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
    /github_pat_[A-Za-z0-9_]{30,}/g,
    new RegExp(`${START}(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])`, 'g'),
    /AIza[0-9A-Za-z_-]{35}/g,
    /xox[abprs]-[A-Za-z0-9-]{10,}/g,
    /npm_[A-Za-z0-9]{36}/g,
    /hf_[A-Za-z0-9]{30,}/g,
    new RegExp(`${START}eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`, 'g'),
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  ];
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

  /* Home folders, as the script hands them over: its own account's home, and
   * the folder that holds it followed by a separator, so another account's
   * home on the same layout is found too. The page knows no home folder and
   * passes none. On Windows the comparison folds case and both slashes, one
   * code point at a time and only where folding keeps the length, so an index
   * in the folded text is the same index in the original. A span runs from
   * the root to the first white space after it, so a root holding a space is
   * masked whole; overlapping spans are merged. */
  const foldOne = c => { const l = c.toLowerCase(); return l.length === c.length ? l : c; };
  const folded = s => [...s].map(foldOne).join('').replaceAll('/', '\\');
  const homeFinder = (homes, fold) => {
    const norm = fold ? folded : s => s;
    const roots = (homes || []).filter(Boolean).map(norm);
    return s => {
      if (!roots.length) return [];
      const text = norm(s);
      const found = [];
      for (const r of roots) for (let i = text.indexOf(r); i >= 0; i = text.indexOf(r, i + 1)) {
        let end = i + r.length;
        while (end < text.length && !/\s/u.test(text[end])) end++;
        found.push([i, end]);
      }
      found.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const [a, b] of found) {
        const last = merged[merged.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], b);
        else merged.push([a, b]);
      }
      return merged;
    };
  };

  /** The shapes a string holds, by name: 'a home folder path', 'a key-shaped
   *  value', 'an email address'. */
  function shapesIn(s, homes, fold) {
    const out = [];
    if (homeFinder(homes, fold)(s).length) out.push('a home folder path');
    if (KEY_SHAPES.some(re => new RegExp(re.source, re.flags.replace('g', '')).test(s))) out.push('a key-shaped value');
    if (new RegExp(EMAIL.source).test(s)) out.push('an email address');
    return out;
  }

  /** The string with every shape it holds replaced by [masked]. */
  function mask(s, homes, fold) {
    let out = s;
    const spans = homeFinder(homes, fold)(out).sort((a, b) => b[0] - a[0]);
    for (const [a, b] of spans) out = out.slice(0, a) + MASK + out.slice(b);
    for (const re of KEY_SHAPES) out = out.replace(re, MASK);
    return out.replace(EMAIL, MASK);
  }
  const MASK = '[masked]';

  /** Every string in a value, with its path, in document order. */
  function stringsOf(v, path, out = []) {
    if (typeof v === 'string') out.push([path, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => stringsOf(x, `${path}[${i}]`, out));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) if (k !== '__proto__') stringsOf(x, path ? `${path}.${keyWord(k)}` : keyWord(k), out);
    return out;
  }

  /* The checks a draft and a block share, bound to one refusal list. Pass 0
   * runs at once: every value has its type before a rule reads it. */
  function checks(root, refuse, K) {
    /* -- pass 0: shape and type. Every value has its type before a rule
     * reads it, and a key named __proto__ is refused wherever it sits, since
     * the page reads the draft as an object literal, where that key sets the
     * prototype rather than a field. */
    const protoWalk = [{ v: root, path: 'file' }];
    while (protoWalk.length) {
      const { v, path } = protoWalk.pop();
      if (!v || typeof v !== 'object') continue;
      if (!Array.isArray(v) && Object.hasOwn(v, '__proto__')) refuse(path, 'a key named "__proto__" is refused: the page would read it as a prototype, not a field');
      for (const [k, x] of Object.entries(v)) {
        if (k === '__proto__' || !x || typeof x !== 'object') continue;
        const seg = Array.isArray(v) ? `[${k}]` : `.${keyWord(k)}`;
        protoWalk.push({ v: x, path: path === 'file' ? seg.replace(/^\./, '') : path + seg });
      }
    }
    const isText = (path, v) => {
      if (typeof v !== 'string') { refuse(path, 'expected a string'); return false; }
      if (v.length > LIMITS.fieldChars) { refuse(path, `longer than the limit of ${count(LIMITS.fieldChars)} characters (${count(v.length)})`); return false; }
      const m = HIDDEN.exec(v);
      if (m) { refuse(path, `holds ${codePoint(m[0])}, a hidden or control character`); return false; }
      return true;
    };
    const oneOf = (path, v, set) => {
      if (typeof v === 'string' && set.includes(v)) return true;
      refuse(path, `not one of ${set.join(', ')}`);
      return false;
    };
    const keys = (path, obj, shape) => {
      if (!isObj(obj)) { refuse(path, 'expected an object'); return false; }
      const named = new Set([...shape.req, ...shape.opt]);
      for (const k of shape.req) if (!Object.hasOwn(obj, k)) refuse(path, `missing required key "${k}"`);
      for (const k of Object.keys(obj)) if (!named.has(k) && k !== '__proto__') refuse(path, `unknown key "${keyWord(k)}"`);
      return true;
    };
    /* A clause's or an option's fields: exactly the kind's names, its
     * optional ones allowed to be absent, each value of its field's type. */
    const fieldsOf = (path, fields, kind) => {
      if (!isObj(fields)) return refuse(path, 'expected an object');
      const byName = new Map(kind.fields.map(f => [f.name, f]));
      for (const k of Object.keys(fields)) if (!byName.has(k) && k !== '__proto__') refuse(path, `unknown key "${keyWord(k)}"`);
      for (const f of kind.fields) {
        if (!Object.hasOwn(fields, f.name)) {
          if (!f.optional) refuse(path, `missing required key "${f.name}"`);
          continue;
        }
        const at = `${path}.${f.name}`;
        if (f.type === 'choice') oneOf(at, fields[f.name], K.choices.get(f.name));
        else isText(at, fields[f.name]);
      }
    };
    const nameOk = (path, v) => {
      if (!isText(path, v)) return false;
      const fault = nameFault(v);
      if (fault) { refuse(path, `the name ${fault}`); return false; }
      return true;
    };
    return { isText, oneOf, keys, fieldsOf, nameOk };
  }

  /** Every refusal of a draft, as [path, reason] pairs, and every warning.
   *  `opts.homes` and `opts.fold` say where home folders are; the page passes
   *  none. */
  function checkDraft(draft, kinds, opts = {}) {
    const refusals = [];
    const warnings = [];
    const refuse = (path, why) => refusals.push([path, why]);
    const K = kindsIndex(kinds);

    const { isText, oneOf, keys, fieldsOf, nameOk } = checks(draft, refuse, K);

    if (!keys('file', draft, TOP)) return { refusals, warnings };
    if (draft.format !== 1) refuse('format', 'unknown format; this script reads format 1');
    isText('title', draft.title);
    oneOf('type', draft.type, TYPES);
    oneOf('level', draft.level, LEVELS);
    if (Object.hasOwn(draft, 'name') && nameOk('name', draft.name) && !NAME_FORMAT.test(draft.name)) {
      warnings.push(['name', 'is outside the skill name format: 1 to 64 characters of a-z, 0-9 and -, not starting or ending with -, with no --']);
    }
    if (Object.hasOwn(draft, 'previous') && keys('previous', draft.previous, PREVIOUS)) {
      const p = draft.previous;
      if (Object.hasOwn(p, 'type')) oneOf('previous.type', p.type, TYPES);
      if (Object.hasOwn(p, 'name')) nameOk('previous.name', p.name);
      if (Object.hasOwn(p, 'hash') && !(typeof p.hash === 'string' && HASH.test(p.hash))) refuse('previous.hash', 'expected 64 lowercase hex digits');
    }
    if (Object.hasOwn(draft, 'rewrite') && keys('rewrite', draft.rewrite, REWRITE)) {
      if (Object.hasOwn(draft.rewrite, 'version') && !(typeof draft.rewrite.version === 'string' && VERSION.test(draft.rewrite.version))) refuse('rewrite.version', 'expected a version such as 0.8.1');
    }

    /* -- the clauses ---------------------------------------------------------- */
    const ids = new Map(); // id -> the path that first used it
    const useId = (path, id) => {
      if (!isText(path, id)) return false;
      if (!ID.test(id)) { refuse(path, 'an id is 1 to 64 characters of a-z, 0-9 and -, starting with a letter or digit'); return false; }
      if (ids.has(id)) { refuse(path, `duplicate id; ${ids.get(id)} uses it first`); return false; }
      ids.set(id, path);
      return true;
    };
    const clauses = new Map(); // id -> { c, kind, part, path }
    const asked = isObj(draft.parts) && typeof draft.level === 'string' && K.levels.has(draft.level) ? K.levels.get(draft.level) : K.parts;
    if (isObj(draft.parts)) {
      for (const k of Object.keys(draft.parts)) if (!K.parts.includes(k) && k !== '__proto__') refuse('parts', `unknown key "${keyWord(k)}"`);
      for (const part of K.parts) {
        if (!Object.hasOwn(draft.parts, part)) { refuse('parts', `missing required key "${part}"`); continue; }
        const list = draft.parts[part];
        if (!Array.isArray(list)) { refuse(`parts.${part}`, 'expected an array'); continue; }
        if (list.length > LIMITS.clausesPerPart) { refuse(`parts.${part}`, `more than the limit of ${count(LIMITS.clausesPerPart)} clauses in one part (${count(list.length)})`); continue; }
        if (list.length && !asked.includes(part)) refuse(`parts.${part}`, `the level ${draft.level} does not ask this part, so it holds no clauses`);
        if (part === 'why' && list.length !== 1) refuse('parts.why', 'holds exactly one clause, of the kind why');
        list.forEach((c, i) => {
          const path = `parts.${part}[${i}]`;
          if (!keys(path, c, CLAUSE)) return;
          const idOk = Object.hasOwn(c, 'id') && useId(`${path}.id`, c.id);
          if (!isText(`${path}.kind`, c.kind)) return;
          const kind = K.byId.get(c.kind);
          if (!kind) return refuse(`${path}.kind`, 'no kind of that name in kinds.json');
          if (kind.part !== part) refuse(`${path}.kind`, `the part ${part} cannot hold this kind; it belongs in ${kind.part}`);
          if (kind.types && TYPES.includes(draft.type) && !kind.types.includes(draft.type)) refuse(`${path}.kind`, TYPE_FAULT(kind));
          if (c.kind === 'name' && draft.type === 'CLAUDE.md') refuse(`${path}.kind`, 'a CLAUDE.md has no name of its own; the draft\'s name is its folder\'s');
          const hasFields = Object.hasOwn(c, 'fields');
          const isNone = Object.hasOwn(c, 'none');
          if (isNone && c.none !== true) refuse(`${path}.none`, 'expected true');
          if (hasFields && isNone) refuse(path, 'holds both fields and none; an agreed none has no fields');
          else if (!hasFields && !isNone) refuse(path, 'holds neither fields nor none');
          if (hasFields) fieldsOf(`${path}.fields`, c.fields, kind);
          if (c.kind === 'why') {
            if (Object.hasOwn(c, 'mark')) refuse(`${path}.mark`, 'the why clause carries no mark until the person writes it');
            if (hasFields && isObj(c.fields) && c.fields.text !== '') refuse(`${path}.fields.text`, 'the why clause is empty in a draft; the person writes it');
          } else if (!Object.hasOwn(c, 'mark')) refuse(path, `missing required key "mark"; every drafted clause is ${PROPOSED}`);
          else if (c.mark !== PROPOSED) refuse(`${path}.mark`, `a draft marks every clause ${PROPOSED}`);
          if (Object.hasOwn(c, 'freedom')) oneOf(`${path}.freedom`, c.freedom, FREEDOMS);
          if (Object.hasOwn(c, 'gate')) {
            isText(`${path}.gate`, c.gate);
            if (c.kind === 'checked') refuse(`${path}.gate`, 'a checked clause carries no gate; its by field is the gate');
          }
          if (Object.hasOwn(c, 'refs')) {
            if (!Array.isArray(c.refs)) refuse(`${path}.refs`, 'expected an array of clause ids');
            else c.refs.forEach((r, j) => isText(`${path}.refs[${j}]`, r));
          }
          if (idOk) clauses.set(c.id, { c, kind, part, path });
        });
      }
    } else refuse('parts', 'expected an object');
    for (const { c, path } of clauses.values()) {
      if (Array.isArray(c.refs)) c.refs.forEach((r, j) => {
        if (typeof r === 'string' && !clauses.has(r)) refuse(`${path}.refs[${j}]`, 'names no clause in this draft');
      });
    }

    /* -- the questions -------------------------------------------------------- */
    if (Array.isArray(draft.questions)) {
      const askedOf = new Map();
      draft.questions.forEach((q, i) => {
        const path = `questions[${i}]`;
        if (!keys(path, q, QUESTION)) return;
        if (Object.hasOwn(q, 'id')) useId(`${path}.id`, q.id);
        isText(`${path}.situation`, q.situation);
        let target;
        if (isText(`${path}.clause`, q.clause)) {
          target = clauses.get(q.clause);
          if (!target) refuse(`${path}.clause`, 'names no clause in this draft');
          else if (target.c.kind === 'why') { refuse(`${path}.clause`, 'the why clause has no question; the person writes it'); target = undefined; }
          else if (askedOf.has(q.clause)) { refuse(`${path}.clause`, `a second question on one clause; ${askedOf.get(q.clause)} asks it first`); target = undefined; }
          else askedOf.set(q.clause, path);
          if (target && !asked.includes(target.part)) refuse(`${path}.clause`, `the level ${draft.level} does not ask this part`);
        }
        if (!Array.isArray(q.chips)) refuse(`${path}.chips`, 'expected an array of strings');
        else q.chips.forEach((ch, j) => isText(`${path}.chips[${j}]`, ch));
        if (!Array.isArray(q.options)) return refuse(`${path}.options`, 'expected an array');
        if (q.options.length < 2 || q.options.length > 4) refuse(`${path}.options`, 'a question offers two to four options');
        const optionIds = new Set();
        q.options.forEach((o, j) => {
          const at = `${path}.options[${j}]`;
          if (!keys(at, o, OPTION)) return;
          if (Object.hasOwn(o, 'id') && useId(`${at}.id`, o.id)) optionIds.add(o.id);
          isText(`${at}.label`, o.label);
          if (target && Object.hasOwn(o, 'fields')) fieldsOf(`${at}.fields`, o.fields, target.kind);
        });
        if (isText(`${path}.proposed`, q.proposed) && !optionIds.has(q.proposed)) refuse(`${path}.proposed`, 'is not an option of this question');
      });
    } else refuse('questions', 'expected an array');

    if (!refusals.length) {
      for (const [path, s] of stringsOf(draft, '')) for (const shape of shapesIn(s, opts.homes, opts.fold)) warnings.push([path, `holds ${shape}; say whether it belongs in the contract`]);
    }
    return { refusals, warnings };
  }
  /* -- answers and marks -------------------------------------------------------
   *
   * The page keeps one answer per clause the person touched: `option`, the id
   * of the option picked, or `fields`, the clause's fields in the person's
   * hands; then `chip`, `flag` and `restored`. `chip` is the place of the
   * reason tapped in the question's chips, counting from 0, never its text,
   * so a chip carries none of the draft's words into chat inside the
   * person's own paste; the read-back prints the chip's text from the draft.
   * `fields` still holds every field of the clause, the ones the person left
   * as drafted word for word. The mark is never
   * stored by the page's controls: it is worked out from how the answer was
   * made, here, so the page and the script give the same mark for the same
   * answer, and a block claiming any other is refused. */

  /** The draft as Maps: each clause with its kind and part, and each
   *  question by the clause it asks about. */
  function draftIndex(draft, K) {
    const clauses = new Map();
    for (const part of K.parts) for (const c of draft.parts[part]) clauses.set(c.id, { c, kind: K.byId.get(c.kind), part });
    const questions = new Map();
    for (const q of draft.questions) questions.set(q.clause, q);
    return { clauses, questions };
  }

  /** Two sets of fields hold the same text, field for field. */
  const sameFields = (a, b) => {
    if (!isObj(a) || !isObj(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every(k => Object.hasOwn(b, k) && a[k] === b[k]);
  };

  /** The mark an answer earns (spec v4 S7 on #313). */
  function markFor(entry, answer) {
    if (answer.restored) return 'Proposed';
    if (entry.kind.id === 'why') return 'Decided';
    const unchanged = entry.kind.stakes === 'high' ? 'Proposed' : 'Confirmed';
    if (Object.hasOwn(answer, 'fields')) return sameFields(answer.fields, entry.c.fields) ? unchanged : 'Decided';
    return unchanged;
  }

  /** The block the page gives the person to copy: one fenced JSON block. */
  function blockOf(draft, kinds, hashes, state) {
    const K = kindsIndex(kinds);
    const ix = draftIndex(draft, K);
    const out = [];
    for (const [id, a] of state.answers) {
      const entry = ix.clauses.get(id);
      const row = { id };
      if (Object.hasOwn(a, 'option')) row.option = a.option;
      else row.fields = a.fields;
      row.mark = markFor(entry, a);
      if (a.chip !== undefined) row.chip = a.chip;
      if (a.flag) row.flag = true;
      if (a.restored) row.restored = true;
      out.push(row);
    }
    return { format: 1, draft: hashes.draft, kinds: hashes.kinds, answers: out, edits: state.edits.slice() };
  }

  /** The block as the text the person copies, fenced. */
  const blockText = block => '```json\n' + JSON.stringify(block, null, 2) + '\n```\n';

  /** Proposals taken as drafted, apart from other picks and edits. */
  function tally(draft, state) {
    const questions = new Map(draft.questions.map(q => [q.clause, q]));
    const clauses = new Map();
    for (const list of Object.values(draft.parts)) for (const c of list) clauses.set(c.id, c);
    const t = { proposalsTaken: 0, otherPicks: 0, edited: 0 };
    for (const [id, a] of state.answers) {
      if (Object.hasOwn(a, 'option')) {
        const q = questions.get(id);
        if (q && a.option === q.proposed) t.proposalsTaken++;
        else t.otherPicks++;
      } else if (sameFields(a.fields, clauses.get(id) && clauses.get(id).fields)) t.proposalsTaken++;
      else t.edited++;
    }
    return t;
  }

  const BLOCK = { req: ['format', 'draft', 'kinds', 'answers', 'edits'], opt: [] };
  const ANSWER = { req: ['id', 'mark'], opt: ['option', 'fields', 'chip', 'flag', 'restored'] };
  const MARKS = ['Proposed', 'Confirmed', 'Decided'];
  /* The folder edits, by op. A clause edit names its clause by `id`; a
   * schedule edit names one kind in one part. A rename names a schedule
   * only: an entry has no name of its own that the contract exports. Any
   * edit may carry `restored`, set by restore until the person keeps it. */
  const EDIT = {
    add: { req: ['op', 'id', 'part', 'kind'], opt: ['fields', 'none', 'restored'] },
    rename: { req: ['op', 'name'], opt: ['id', 'part', 'kind', 'restored'] },
    move: { req: ['op', 'to'], opt: ['id', 'part', 'kind', 'restored'] },
    remove: { req: ['op'], opt: ['id', 'part', 'kind', 'restored'] },
    rekind: { req: ['op', 'id', 'kind', 'fields'], opt: ['restored'] },
    none: { req: ['op', 'part', 'kind'], opt: ['restored'] },
  };
  const OPS = Object.keys(EDIT);

  /** Every refusal of a block against its draft and the running kinds table,
   *  as [path, reason] pairs. `hashes` holds the SHA-256 of each. The draft
   *  has passed checkDraft. */
  function checkBlock(block, draft, kinds, hashes) {
    const refusals = [];
    const refuse = (path, why) => refusals.push([path, why]);
    const K = kindsIndex(kinds);
    const { isText, oneOf, keys, fieldsOf } = checks(block, refuse, K);
    if (!keys('file', block, BLOCK)) return { refusals, warnings: [] };
    if (block.format !== 1) refuse('format', 'unknown format; this script reads format 1');
    if (block.kinds !== hashes.kinds) refuse('kinds', 'the skill changed since this page was made; render it again');
    if (block.draft !== hashes.draft) refuse('draft', 'the block was made from another draft; copy it again from the page made from this draft');
    const ix = draftIndex(draft, K);

    if (!Array.isArray(block.answers)) refuse('answers', 'expected an array');
    else {
      const seen = new Map();
      block.answers.forEach((a, i) => {
        const path = `answers[${i}]`;
        if (!keys(path, a, ANSWER)) return;
        if (!isText(`${path}.id`, a.id)) return;
        const entry = ix.clauses.get(a.id);
        if (!entry) return refuse(`${path}.id`, 'names no clause in this draft');
        if (seen.has(a.id)) return refuse(`${path}.id`, `a second answer for one clause; ${seen.get(a.id)} answers it first`);
        seen.set(a.id, path);
        const hasOption = Object.hasOwn(a, 'option');
        const hasFields = Object.hasOwn(a, 'fields');
        if (hasOption && hasFields) return refuse(path, 'holds both option and fields; an answer is one or the other');
        if (!hasOption && !hasFields) return refuse(path, 'holds neither option nor fields');
        const q = ix.questions.get(a.id);
        let ok = true;
        if (hasOption) {
          if (!isText(`${path}.option`, a.option)) ok = false;
          else if (!q || !q.options.some(o => o.id === a.option)) { refuse(`${path}.option`, 'is not an option of this clause\'s question'); ok = false; }
        } else if (entry.c.none) {
          refuse(`${path}.fields`, 'this clause is an agreed none; replace it with an added entry');
          ok = false;
        } else {
          const before = refusals.length;
          fieldsOf(`${path}.fields`, a.fields, entry.kind);
          if (refusals.length > before) ok = false;
          else if (entry.kind.id === 'why' && a.fields.text.trim() === '') { refuse(`${path}.fields.text`, 'the why answer is the person\'s own words, and cannot be empty'); ok = false; }
        }
        if (Object.hasOwn(a, 'chip') && !(q && Number.isInteger(a.chip) && a.chip >= 0 && a.chip < q.chips.length)) refuse(`${path}.chip`, 'is not a chip of this clause\'s question; expected its place in the question\'s chips, counting from 0');
        if (Object.hasOwn(a, 'flag') && a.flag !== true) refuse(`${path}.flag`, 'expected true, or no flag');
        if (Object.hasOwn(a, 'restored') && a.restored !== true) refuse(`${path}.restored`, 'expected true, or no restored');
        if (oneOf(`${path}.mark`, a.mark, MARKS) && ok) {
          const earned = markFor(entry, { ...(hasOption ? { option: a.option } : { fields: a.fields }), restored: a.restored === true });
          if (a.mark !== earned) refuse(`${path}.mark`, `the mark ${a.mark} is not what this answer earns; it earns ${earned}`);
        }
      });
    }

    if (!Array.isArray(block.edits)) refuse('edits', 'expected an array');
    else {
      /* The clauses alive as the edits run in order, each with its current
       * kind: the draft's, plus each one added, minus each one removed, by
       * id, by schedule or by an agreed none, exactly as readBack and the
       * export remove them. */
      const live = new Map([...ix.clauses].map(([id, e]) => [id, { part: e.part, kind: e.c.kind }]));
      const dropSchedule = (part, kindId) => { for (const [id, x] of [...live]) if (x.part === part && x.kind === kindId) live.delete(id); };
      const ids = new Set(ix.clauses.keys());
      for (const q of draft.questions) { ids.add(q.id); for (const o of q.options) ids.add(o.id); }
      const perPart = new Map(K.parts.map(p => [p, draft.parts[p].length]));
      const asked = K.levels.get(draft.level);
      /* A part the level does not ask holds no clauses (spec v4 S6), so an
       * edit cannot add one there or agree a none in it. */
      const askedPart = (path, part) => {
        if (asked.includes(part)) return true;
        refuse(`${path}.part`, `the level ${draft.level} does not ask this part, so it takes no added clause and no agreed none`);
        return false;
      };
      const kindIn = (path, part, kindId) => {
        if (!oneOf(`${path}.part`, part, K.parts)) return null;
        if (!isText(`${path}.kind`, kindId)) return null;
        const kind = K.byId.get(kindId);
        if (!kind) { refuse(`${path}.kind`, 'no kind of that name in kinds.json'); return null; }
        if (kind.part !== part) { refuse(`${path}.kind`, `the part ${part} cannot hold this kind; it belongs in ${kind.part}`); return null; }
        if (kind.types && !kind.types.includes(draft.type)) { refuse(`${path}.kind`, TYPE_FAULT(kind)); return null; }
        return kind;
      };
      const target = (path, e) => {
        if (Object.hasOwn(e, 'id')) {
          if (Object.hasOwn(e, 'part') || Object.hasOwn(e, 'kind')) { refuse(path, 'names a clause by id, or a schedule by part and kind, not both'); return false; }
          if (!isText(`${path}.id`, e.id)) return false;
          if (!live.has(e.id)) { refuse(`${path}.id`, 'names no clause in this draft or its edits'); return false; }
          return true;
        }
        if (!Object.hasOwn(e, 'part') || !Object.hasOwn(e, 'kind')) { refuse(path, 'names neither a clause by id nor a schedule by part and kind'); return false; }
        return kindIn(path, e.part, e.kind) !== null;
      };
      block.edits.forEach((e, i) => {
        const path = `edits[${i}]`;
        if (!isObj(e)) return refuse(path, 'expected an object');
        if (!oneOf(`${path}.op`, e.op, OPS)) return;
        if (!keys(path, e, EDIT[e.op])) return;
        if (Object.hasOwn(e, 'restored') && e.restored !== true) refuse(`${path}.restored`, 'expected true, or no restored');
        if (e.op === 'add') {
          const kind = kindIn(path, e.part, e.kind);
          const inAsked = kind !== null && askedPart(path, e.part);
          if (isText(`${path}.id`, e.id)) {
            if (!ID.test(e.id)) refuse(`${path}.id`, 'an id is 1 to 64 characters of a-z, 0-9 and -, starting with a letter or digit');
            else if (ids.has(e.id)) refuse(`${path}.id`, 'duplicate id; the draft or an earlier edit uses it');
            else if (inAsked) {
              ids.add(e.id);
              live.set(e.id, { part: e.part, kind: e.kind });
              perPart.set(e.part, perPart.get(e.part) + 1);
              if (perPart.get(e.part) > LIMITS.clausesPerPart) refuse(path, `more than the limit of ${count(LIMITS.clausesPerPart)} clauses in one part`);
            }
          }
          const hasFields = Object.hasOwn(e, 'fields');
          if (hasFields === Object.hasOwn(e, 'none')) refuse(path, 'an added clause holds fields, or none, and not both');
          else if (hasFields && kind) fieldsOf(`${path}.fields`, e.fields, kind);
          else if (!hasFields && e.none !== true) refuse(`${path}.none`, 'expected true');
        } else if (e.op === 'rekind') {
          if (target(path, { id: e.id })) {
            const kind = kindIn(path, live.get(e.id).part, e.kind);
            if (kind) {
              fieldsOf(`${path}.fields`, e.fields, kind);
              live.get(e.id).kind = e.kind;
            }
          }
        } else if (e.op === 'none') {
          if (kindIn(path, e.part, e.kind) && askedPart(path, e.part)) dropSchedule(e.part, e.kind);
        } else if (e.op === 'rename' && Object.hasOwn(e, 'id')) refuse(path, 'a rename names a schedule by part and kind; an entry has no name of its own');
        else if (target(path, e)) {
          if (e.op === 'rename') isText(`${path}.name`, e.name);
          if (e.op === 'move' && !(Number.isInteger(e.to) && e.to >= 0)) refuse(`${path}.to`, 'expected an index, 0 or more');
          if (e.op === 'remove') {
            if (Object.hasOwn(e, 'id')) live.delete(e.id);
            else dropSchedule(e.part, e.kind);
          }
        }
      });
    }
    return { refusals, warnings: [] };
  }
  /* -- reading a block back ----------------------------------------------------
   *
   * What --answers prints, after the block passes its check. Every string
   * from a file prints as a quoted literal after its clause and field name,
   * so it cannot read as a line of the list around it. A field the export
   * writes prints whole: past 2,000 characters it continues on numbered lines
   * of that length. A label or a chip is cut at 200. Every value holding a
   * home path, a key shape or an email prints masked, and is warned on. */
  const WHOLE = 2000;
  const CUT = 200;
  const cut = s => (s.length > CUT ? `${s.slice(0, CUT)}… (${count(s.length)} characters)` : s);
  /** A short string from a file as a line may print it: masked, then cut at
   *  200, then quoted. Masking comes first, so a shape cut in two still
   *  masks. */
  const quoted = (s, homes, fold) => JSON.stringify(cut(mask(s, homes, fold)));

  function readBack(block, draft, kinds, opts = {}) {
    const K = kindsIndex(kinds);
    const ix = draftIndex(draft, K);
    const changes = [];
    const warnings = [];
    const back = new Map(); // "part/id" -> reasons
    const push = (at, why) => {
      if (!back.has(at)) back.set(at, []);
      if (!back.get(at).includes(why)) back.get(at).push(why);
    };
    /* A string from a file, masked. `name` says where it is, for a warning;
     * `at` is the clause it belongs to, for push-back. */
    const literal = (s, name, at) => {
      const shapes = shapesIn(s, opts.homes, opts.fold);
      for (const shape of shapes) warnings.push([name, `holds ${shape}; ask whether it belongs in the contract`]);
      if (shapes.length && at) push(at, 'a warned field');
      return mask(s, opts.homes, opts.fold);
    };
    const whole = (head, s) => {
      for (let i = 0, n = 1; i < s.length || n === 1; i += WHOLE, n++) {
        const chunk = JSON.stringify(s.slice(i, i + WHOLE));
        changes.push(n === 1 ? `  ${head} ${chunk}` : `    (${n}) ${chunk}`);
      }
    };
    const fieldLines = (at, fields, name) => {
      for (const [k, v] of Object.entries(fields)) whole(`${at} ${k}`, literal(v, name(k), at));
    };
    /* A drafted field the answer leaves out, which the export then drops with
     * the words that join it: named, so a dropped consequence is seen. */
    const removedLines = (at, drafted, fields) => {
      if (!isObj(drafted)) return;
      for (const k of Object.keys(drafted)) if (!Object.hasOwn(fields, k)) changes.push(`  ${at} ${k} removed`);
    };
    /* The title prints on the ok line; it is warned on here, as in the check. */
    for (const shape of shapesIn(draft.title, opts.homes, opts.fold)) warnings.push(['title', `holds ${shape}; ask whether it belongs in the contract`]);

    block.answers.forEach((a, i) => {
      const e = ix.clauses.get(a.id);
      const at = `${e.part}/${a.id}`;
      const chip = a.chip !== undefined ? `; chip ${JSON.stringify(cut(literal(ix.questions.get(a.id).chips[a.chip], `${at} chip`, at)))}` : '';
      const tail = `; marked ${a.mark}${chip}${a.flag ? '; flagged for push-back' : ''}`;
      if (a.flag) push(at, 'flagged');
      if (a.restored) push(at, 'restored, not kept');
      if (Object.hasOwn(a, 'option')) {
        const q = ix.questions.get(a.id);
        const o = q.options.find(x => x.id === a.option);
        const label = JSON.stringify(cut(literal(o.label, `${at} label`, at)));
        changes.push(`  ${at} ${a.restored ? 'restored, not kept, ' : ''}picked ${label}, ${o.id === q.proposed ? 'the proposal' : 'not the proposal'}${tail}`);
        fieldLines(at, o.fields, k => `${at} ${k}`);
        removedLines(at, e.c.fields, o.fields);
      } else {
        const same = sameFields(a.fields, e.c.fields);
        changes.push(`  ${at} ${a.restored ? 'restored, not kept' : same ? 'agreed as drafted' : 'wrote its own words'}${tail}`);
        const changed = Object.fromEntries(Object.entries(a.fields).filter(([k, v]) => !(isObj(e.c.fields) && e.c.fields[k] === v)));
        fieldLines(at, a.restored ? a.fields : changed, k => `answers[${i}].fields.${k}`);
        removedLines(at, e.c.fields, a.fields);
      }
    });

    /* The clauses as the edits leave them, in order, each with its kind. */
    const live = new Map([...ix.clauses].map(([id, x]) => [id, { part: x.part, kind: x.kind }]));
    const schedule = e => `the ${e.part} schedule of ${e.kind}`;
    const gone = new Map(); // id -> { part, kind }
    const removeOne = id => {
      const x = live.get(id);
      gone.set(id, x);
      live.delete(id);
      if (x.kind.stakes === 'high') push(`${x.part}/${id}`, 'a high-stakes clause removed');
    };
    block.edits.forEach((e, i) => {
      const name = k => `edits[${i}].${k}`;
      /* A restored edit came back from the browser's store: the person has
       * not kept it in this page, so it prints as restored and is pushed
       * back, at its clause or its schedule. */
      const edit = e.restored ? '  edit (restored):' : '  edit:';
      const restoredAt = at => { if (e.restored) push(at, 'a restored edit'); };
      const scheduleAt = `${e.part}/(${e.kind})`;
      if (e.op === 'add') {
        const kind = K.byId.get(e.kind);
        live.set(e.id, { part: e.part, kind });
        changes.push(`${edit} added ${e.part}/${e.id}, ${e.none ? `an agreed none of ${e.kind}` : kind.kind}`);
        restoredAt(`${e.part}/${e.id}`);
        if (e.fields) fieldLines(`${e.part}/${e.id}`, e.fields, k => `${name('fields')}.${k}`);
      } else if (e.op === 'rename') {
        changes.push(`${edit} renamed ${schedule(e)} ${JSON.stringify(cut(literal(e.name, name('name'))))}`);
        restoredAt(scheduleAt);
      } else if (e.op === 'move') {
        const at = e.id !== undefined ? `${live.get(e.id).part}/${e.id}` : schedule(e);
        changes.push(`${edit} moved ${at} to place ${e.to + 1}`);
        restoredAt(e.id !== undefined ? at : scheduleAt);
      } else if (e.op === 'remove') {
        if (e.id !== undefined) {
          const at = `${live.get(e.id).part}/${e.id}`;
          changes.push(`${edit} removed ${at}`);
          restoredAt(at);
          removeOne(e.id);
        } else {
          changes.push(`${edit} removed ${schedule(e)}`);
          restoredAt(scheduleAt);
          for (const [id, x] of [...live]) if (x.part === e.part && x.kind.id === e.kind) removeOne(id);
        }
      } else if (e.op === 'rekind') {
        const x = live.get(e.id);
        const kind = K.byId.get(e.kind);
        changes.push(`${edit} re-kinded ${x.part}/${e.id} from ${x.kind.id} to ${kind.id}`);
        restoredAt(`${x.part}/${e.id}`);
        if (x.kind.stakes === 'high' && kind.stakes !== 'high') push(`${x.part}/${e.id}`, 're-kinded away from a high-stakes kind');
        live.set(e.id, { part: x.part, kind });
        fieldLines(`${x.part}/${e.id}`, e.fields, k => `${name('fields')}.${k}`);
      } else if (e.op === 'none') {
        changes.push(`${edit} agreed none for ${schedule(e)}`);
        restoredAt(scheduleAt);
        for (const [id, x] of [...live]) if (x.part === e.part && x.kind.id === e.kind) { gone.set(id, x); live.delete(id); }
        if (K.byId.get(e.kind).stakes === 'high') push(scheduleAt, 'a high-stakes kind agreed none');
      }
    });
    /* A removed clause another clause still names. */
    for (const [id, x] of gone) {
      const namers = [...live.keys()].filter(other => ix.clauses.has(other) && (ix.clauses.get(other).c.refs || []).includes(id));
      if (namers.length) push(`${x.part}/${id}`, `removed, and named by ${namers.map(o => `${live.get(o).part}/${o}`).join(', ')}`);
    }
    for (const [id, x] of live) {
      if (x.kind.stakes === 'high') push(`${x.part}/${id}`, 'a high-stakes clause');
      if (opts.shared) push(`${x.part}/${id}`, 'a clause of a shared draft');
    }
    /* Push-back in the draft's order, then what the edits added. */
    const order = new Map();
    for (const id of [...ix.clauses.keys(), ...live.keys()]) {
      const x = live.get(id) || gone.get(id);
      if (!order.has(`${x.part}/${id}`)) order.set(`${x.part}/${id}`, order.size);
    }
    const rank = at => (order.has(at) ? order.get(at) : order.size);
    const pushback = [...back].sort((a, b) => rank(a[0]) - rank(b[0])).map(([at, why]) => `  ${at}: ${why.join('; ')}`);
    return { changes, pushback, warnings };
  }

  /* -- the export --------------------------------------------------------------
   *
   * The contract the answers make, in the template's shape: the title block,
   * then all eight part headings in order, a part the level does not ask left
   * empty. Each part lists its clauses kind by kind, each kind under its own
   * name, each clause in its plain frame with its mark. Three kinds are table
   * rows, with the template's columns; the mark folds into each row's last
   * cell. Text is Markdown source and is written as is; in a table cell a
   * pipe is escaped and a line break written as <br>, so a cell stays one
   * cell. */
  const TABLES = new Map([
    ['rule', { head: ['Rule', 'Guards against', 'Status', 'Gated by, freedom'], row: f => [f.rule || '', f.guards, f.status === 'observed' && f.seen ? `observed: ${f.seen}` : f.status] }],
    ['term', { head: ['Term', 'Plain meaning', 'Standard'], row: f => [f.word, f.meaning] }],
    ['probation', { head: ['Question', 'Why it is open', 'Settled when'], row: f => [f.question, f['why-open']] }],
  ]);
  /* The last cell of a row, before its mark: a rule's gate and freedom, a
   * term's standard, a probation check's settling event. */
  const lastCell = (k, x) => {
    if (k === 'rule') return [x.gate && `Gated by: ${cell(x.gate)}`, x.freedom].filter(Boolean).join(', ');
    if (k === 'term') return cell(x.fields.standard || '');
    return cell(x.fields['settled-when']);
  };
  /* A backslash is escaped first, so a typed one before a pipe cannot
   * escape the pipe's escape and end the cell. */
  const cell = s => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const markText = m => (m === 'Proposed' ? '*Proposed*' : m ? `**${m}**` : '(not answered yet)');
  const capital = s => s.charAt(0).toUpperCase() + s.slice(1);

  /** A plain frame with its blanks filled in field order. A missing optional
   *  field drops its blank and the words that join it on. */
  function fill(frame, kind, fields, words) {
    const pieces = frame.split('___');
    let out = pieces[0];
    kind.fields.forEach((f, i) => {
      let next = pieces[i + 1] === undefined ? '' : pieces[i + 1];
      if (!Object.hasOwn(fields, f.name)) {
        out = out.replace(/(,? and |; | \(|: |, )$/, m => { if (m === ' (') next = next.replace(/^\)/, ''); return ''; });
      } else {
        const v = fields[f.name];
        out += f.type === 'choice' && Object.hasOwn(words, v) ? words[v] : v;
      }
      out += next;
    });
    return out;
  }

  /** The clauses of the contract as the answers and edits leave them: per
   *  part, in order, each with its kind, fields, mark and schedule name. */
  function finalClauses(draft, K, block) {
    const ix = draftIndex(draft, K);
    const answered = new Map(block.answers.map(a => [a.id, a]));
    const parts = new Map(K.parts.map(p => [p, []]));
    for (const part of K.parts) for (const c of draft.parts[part]) {
      const a = answered.get(c.id);
      const kind = K.byId.get(c.kind);
      let fields = c.fields;
      if (a) fields = Object.hasOwn(a, 'option') ? ix.questions.get(c.id).options.find(o => o.id === a.option).fields : a.fields;
      parts.get(part).push({ id: c.id, kind, fields, none: c.none === true, gate: c.gate, freedom: c.freedom, mark: a ? a.mark : c.kind === 'why' ? null : 'Proposed' });
    }
    const names = new Map(); // "part/kind" -> schedule name
    const order = new Map(K.parts.map(p => [p, []])); // schedule order per part
    const where = id => { for (const [part, list] of parts) { const i = list.findIndex(x => x.id === id); if (i >= 0) return { part, list, i }; } return null; };
    for (const e of block.edits) {
      /* The person's own edit is Decided; one restored from the store and
       * not kept since is theirs only once they say so, so Proposed. */
      const mark = e.restored ? 'Proposed' : 'Decided';
      if (e.op === 'add') parts.get(e.part).push({ id: e.id, kind: K.byId.get(e.kind), fields: e.fields || {}, none: e.none === true, mark });
      else if (e.op === 'none') {
        const list = parts.get(e.part).filter(x => x.kind.id !== e.kind);
        // The stand-in's id holds a colon, which no clause id may, so no
        // later edit by id can reach it.
        list.push({ id: `none:${e.kind}`, kind: K.byId.get(e.kind), fields: {}, none: true, mark });
        parts.set(e.part, list);
      } else if (e.op === 'rekind') {
        const w = where(e.id);
        w.list[w.i] = { ...w.list[w.i], kind: K.byId.get(e.kind), fields: e.fields, none: false, mark };
      } else if (e.op === 'remove') {
        if (e.id !== undefined) { const w = where(e.id); w.list.splice(w.i, 1); }
        else parts.set(e.part, parts.get(e.part).filter(x => x.kind.id !== e.kind));
      } else if (e.op === 'move') {
        if (e.id !== undefined) { const w = where(e.id); const [x] = w.list.splice(w.i, 1); w.list.splice(Math.min(e.to, w.list.length), 0, x); }
        else { const o = order.get(e.part).filter(k => k !== e.kind); o.splice(Math.min(e.to, o.length), 0, e.kind); order.set(e.part, o); }
      } else if (e.op === 'rename') names.set(`${e.part}/${e.kind}`, e.name);
    }
    return { parts, names, order };
  }

  /** The contract as Markdown. */
  function exportContract(draft, kinds, block) {
    const K = kindsIndex(kinds);
    const words = kinds.words || {};
    const { parts, names, order } = finalClauses(draft, K, block);
    const version = draft.rewrite ? `${Number(draft.rewrite.version.split('.')[0]) + 1}.0.0` : '0.1.0';
    const out = [`# Contract: ${draft.name}`, '', `Version: ${version}`, `Kind: ${draft.type}`, `Level: ${draft.level}`, ''];
    for (const part of K.parts) {
      out.push(`## ${part}`, '');
      const list = parts.get(part);
      const kindsHere = [];
      for (const k of order.get(part)) if (list.some(x => x.kind.id === k)) kindsHere.push(k);
      for (const x of list) if (!kindsHere.includes(x.kind.id)) kindsHere.push(x.kind.id);
      for (const k of kindsHere) {
        const kind = K.byId.get(k);
        const entries = list.filter(x => x.kind.id === k);
        out.push(`**${names.get(`${part}/${k}`) || capital(kind.kind)}**`, '');
        const table = TABLES.get(k);
        if (table && !entries.every(x => x.none)) {
          out.push(`| ${table.head.join(' | ')} |`, `|${table.head.map(() => '---').join('|')}|`);
          for (const x of entries) {
            if (x.none) continue;
            const cells = table.row(x.fields).map(cell);
            const last = [lastCell(k, x), markText(x.mark)].filter(Boolean).join('; ');
            out.push(`| ${[...cells, last].join(' | ')} |`);
          }
        } else for (const x of entries) {
          const text = x.none ? 'None.' : fill(kind.plain, kind, x.fields, words);
          out.push(`- ${text.replace(/\n/g, '\n  ')} ${markText(x.mark)}`);
        }
        out.push('');
      }
    }
    return out.join('\n');
  }

  /* -- keeping answers in the browser -------------------------------------------
   *
   * The page keeps answers under `contract-interview:<type>:<name>:<hash>`,
   * the hash being the draft's, so a reopened page finds them and no other
   * draft's. The name refusal keeps a colon out of <name>. `store` is the
   * browser's localStorage on a page opened from disk, nothing on the
   * published example, and a Map in the tests. Every read and write survives
   * a store that is missing or throws: answers then live only as long as the
   * page. The answers are not encrypted; the line that says why is drafted
   * for the threat model (issue 343). */
  const PREFIX = 'contract-interview:';
  const prefixOf = (type, name) => `${PREFIX}${type}:${name}:`;
  const keyOf = (draft, hash) => prefixOf(draft.type, draft.name) + hash;
  const safely = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  /** What each saved answer was made against, so a redraft can tell whether
   *  the clause, the option it picked and the chip it tapped are still byte
   *  for byte the same. */
  function basisOf(draft, kinds, state) {
    const ix = draftIndex(draft, kindsIndex(kinds));
    const basis = {};
    for (const [id, a] of state.answers) {
      const e = ix.clauses.get(id);
      const b = { kind: e.c.kind, fields: JSON.stringify(e.c.fields === undefined ? null : e.c.fields) };
      if (Object.hasOwn(a, 'option')) b.option = JSON.stringify(ix.questions.get(id).options.find(o => o.id === a.option).fields);
      if (a.chip !== undefined) b.chip = JSON.stringify(ix.questions.get(id).chips[a.chip]);
      basis[id] = b;
    }
    return basis;
  }

  /** Save the page's answers under this draft's key. */
  function save(store, draft, kinds, hashes, state) {
    if (!store) return false;
    const entry = { block: blockOf(draft, kinds, hashes, state), basis: basisOf(draft, kinds, state) };
    return safely(() => { store.setItem(keyOf(draft, hashes.draft), JSON.stringify(entry)); return true; }, false);
  }

  /* An entry read back. Its block goes through the block check before any of
   * it is used, and the whole entry is dropped on any failure. */
  function entryAt(store, key, draft, kinds, hashes) {
    const text = safely(() => store.getItem(key), null);
    if (typeof text !== 'string') return null;
    const entry = safely(() => JSON.parse(text), null);
    if (!isObj(entry) || !Object.hasOwn(entry, 'block') || !Object.hasOwn(entry, 'basis') || !isObj(entry.basis)) return { bad: true };
    if (checkBlock(entry.block, draft, kinds, hashes).refusals.length) return { bad: true };
    return entry;
  }
  const stateOf = block => ({
    answers: new Map(block.answers.map(a => {
      const { id, mark, ...rest } = a;
      void mark;
      return [id, { ...rest, restored: true }];
    })),
    edits: block.edits.map(e => ({ ...e, restored: true })),
  });

  /** The answers and folder edits saved for this draft, each marked restored
   *  until the person keeps it, and how many answers came back. */
  function restore(store, draft, kinds, hashes) {
    const empty = { state: { answers: new Map(), edits: [] }, count: 0, dropped: false };
    if (!store) return empty;
    const entry = entryAt(store, keyOf(draft, hashes.draft), draft, kinds, hashes);
    if (!entry) return empty;
    if (entry.bad) return { ...empty, dropped: true };
    const state = stateOf(entry.block);
    return { state, count: state.answers.size, dropped: false };
  }

  /** A redraft carries over the answers saved under `previous`, and only
   *  those still made against byte-identical text. It reads no other key.
   *  On a shared page it reads no key under another type or name. */
  function redraft(store, draft, kinds, hashes, opts = {}) {
    const none = { adopted: [], dropped: [], note: '' };
    if (!store || !isObj(draft.previous)) return none;
    const p = draft.previous;
    const elsewhere = p.type !== draft.type || p.name !== draft.name;
    /* What a note says about earlier answers left in the store: Reset here
     * reaches them only under this draft's type and name. */
    const left = why => `${why} Reset here ${elsewhere ? 'does not clear them: to clear them, render the earlier draft and press Reset there.' : 'clears them.'}`;
    if (elsewhere && opts.shared) return { ...none, note: left('Earlier answers under another name were left alone.') };
    const oldKey = prefixOf(p.type, p.name) + p.hash;
    const text = safely(() => store.getItem(oldKey), null);
    const entry = typeof text === 'string' ? safely(() => JSON.parse(text), null) : null;
    if (!isObj(entry) || !isObj(entry.block) || !Array.isArray(entry.block.answers) || !isObj(entry.basis)) return none;
    const ix = draftIndex(draft, kindsIndex(kinds));
    const adopted = [];
    const dropped = [];
    const state = { answers: new Map(), edits: [] };
    for (const a of entry.block.answers) {
      const id = isObj(a) && typeof a.id === 'string' ? a.id : null;
      const b = id && Object.hasOwn(entry.basis, id) ? entry.basis[id] : null;
      const e = id ? ix.clauses.get(id) : undefined;
      let same = Boolean(b && e && b.kind === e.c.kind && b.fields === JSON.stringify(e.c.fields === undefined ? null : e.c.fields));
      if (same && Object.hasOwn(a, 'option')) {
        const q = ix.questions.get(id);
        const o = q && q.options.find(x => x.id === a.option);
        same = Boolean(o && b.option === JSON.stringify(o.fields));
      }
      /* A chip is carried by its place, so the text at that place must be
       * the same too. A chip that is not a place is left to the block check. */
      if (same && Number.isInteger(a.chip)) {
        const q = ix.questions.get(id);
        same = Boolean(q && b.chip === JSON.stringify(q.chips[a.chip]));
      }
      if (!id) continue;
      if (!same) { dropped.push(id); continue; }
      const rest = Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'id' && k !== 'mark'));
      state.answers.set(id, { ...rest, restored: true });
      adopted.push(id);
    }
    /* Kept only if the carried answers pass the new draft's block check. */
    const block = blockOf(draft, kinds, hashes, state);
    if (checkBlock(block, draft, kinds, hashes).refusals.length) return { adopted: [], dropped: [...adopted, ...dropped], note: left('Earlier answers no longer fit this draft and were left alone.') };
    /* The old entry goes only once the new one is saved; a failed save
     * leaves it, so a later redraft can carry the answers over again, and
     * the note says where it stays. */
    const gone = save(store, draft, kinds, hashes, state) && safely(() => (store.removeItem(oldKey), true), false);
    return { adopted, dropped, note: gone ? '' : left('Saving here failed, so the earlier answers were kept where they were.') };
  }

  /** Reset: remove every key under this contract's prefix, and nothing else.
   *  The light or dark choice stays. Returns how many keys went. */
  function forget(store, draft) {
    if (!store) return 0;
    const prefix = prefixOf(draft.type, draft.name);
    const keys = safely(() => Array.from({ length: store.length }, (_, i) => store.key(i)), []);
    let n = 0;
    for (const k of keys) if (typeof k === 'string' && k.startsWith(prefix) && safely(() => (store.removeItem(k), true), false)) n++;
    return n;
  }

  /* -- what the page shows ------------------------------------------------------
   *
   * The page draws the contract as the person's answers and edits leave it,
   * from the same reading the export uses, so what it shows is what the block
   * will write. */

  /** The clauses as the page's state leaves them: per part, each with its
   *  kind, fields, mark and schedule name, and the schedule order. */
  function view(draft, kinds, hashes, state) {
    return finalClauses(draft, kindsIndex(kinds), blockOf(draft, kinds, hashes, state));
  }

  /** A clause's sentence: one of its kind's frames, its blanks filled in
   *  field order, a choice shown by the template's words. A frame may have
   *  fewer blanks than its kind has fields, as a rule's does; the fields past
   *  its last blank stay out of the sentence. */
  const sentence = (kinds, kind, fields, frame) => {
    const blanks = kind[frame].split('___').length - 1;
    return fill(kind[frame], { ...kind, fields: kind.fields.slice(0, blanks) }, fields, kinds.words || {});
  };

  /** What a question shows before and after a pick. A high-stakes question
   *  shows no proposal and no fields until the person picks; a low-stakes one
   *  shows Claude's proposal at once. Stakes come from kinds.json, never the
   *  draft, which has no say in them. */
  function reveal(draft, kinds, clauseId, picked) {
    const K = kindsIndex(kinds);
    const entry = draftIndex(draft, K).clauses.get(clauseId);
    const high = !entry || entry.kind.stakes === 'high';
    const shown = picked || !high;
    return { high, proposal: shown, fields: shown };
  }

  return { LIMITS, save, restore, redraft, forget, readBack, exportContract, checkDraft, shapesIn, mask, quoted, folded, KEY_SHAPES, blockOf, blockText, checkBlock, tally, view, sentence, reveal };
})();
if (typeof module !== 'undefined') module.exports = Interview;

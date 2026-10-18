/** The status the head chef writes on a card, from a fixed set. */
export type Status = 'working' | 'needs-you' | 'done' | 'stopped'

/** One session the lead started, as its roster card says. */
export type Card = {
  title: string
  work: string
  phase: string
  settings: string
  status: Status
  /** A Desktop session's local id (local_...). */
  desktopId?: string
  /** A background session's id. */
  bgId?: string
  /** The session's https link on claude.ai, when the head chef knows it. */
  url?: string
  /** The session's PR number as text, 1 to 7 digits. */
  pr?: string
  /** The head chef's last-known state of that PR, used when `gh` has no answer. */
  prState?: PrState
  /** When the card entered its current status and phase, in milliseconds on
   *  the engine clock. The tool stamps it; the file may hold it. */
  since?: number
}

/** A PR's state, as the card keeps it and as `gh`'s answer is read. */
export type PrState = 'open' | 'merged' | 'closed'

/** Something waiting on the owner that no card already shows. */
export type Todo = { id: string; text: string; session?: string }

/** A lead session's roster file, after its shape check. */
export type Roster = { cards: Card[]; todos: Todo[] }

/** A report from another session: its claimed sender and first line. */
export type Report = { from: string; line: string; at: string }

/** A pair from a lookup, kept as a list so no key reaches a prototype. */
export type Pair = { name: string; value: string }

/** Where the roster file is, and the one before a clear or a resume. */
export type Files = { current: string; previous: string }

/** What the engine said at session start: the id and its transcript path. */
export type Start = { sessionId: string; transcript: string }

/** One rate-limit window: its kind, how much of it is used, when it resets. */
export type UsageLimit = { kind: string; percent: number; resetsAt?: string }

/** One row of the context breakdown: its name, what it is, its tokens. */
export type UsageCategory = { name: string; kind: string; tokens: number }

/** This session's usage as the pane last read it: only the fields it draws.
 *  `categories` is absent when no breakdown was asked for. */
export type UsageSnapshot = {
  limits: UsageLimit[]
  context: { percent?: number; tokens?: number; window?: number }
  categories?: UsageCategory[]
}

/** One reading of this session's own session limit (`five_hour`): when it
 *  was taken, in epoch ms, and the percent used. */
export type Sample = { at: number; percent: number }

/** One card's cache warmth, from its session's summary file or its
 *  transcript: the last real model call's time, its context tokens and its
 *  cache window (from a transcript, absent when no call that wrote cache says
 *  it; from a summary file, a fixed hour, absent when no call wrote or read
 *  cache); or unknown, because the transcript is too
 *  large to read or two sessions share the card's name; or not read yet,
 *  because the session has been working since the pane first saw it; or not
 *  found, because no transcript passed the finder's checks. No path is kept. */
export type Warmth =
  | { name: string; kind: 'call'; at: number; tokens: number; windowMs?: number }
  | { name: string; kind: 'too-large' | 'shared' | 'unread' | 'not-found' }

/** One card's call series, from its session's summary file or its
 *  transcript: the time its burn buckets end, the end of the clock minute
 *  of the read or the write that gave it; the context window of its model's
 *  family, in tokens, from a fixed table (absent when the table has none);
 *  the new tokens of each of the 30 clock minutes up to that time, oldest
 *  first; and the context size of each of the last 30 calls, oldest first. Numbers only: no path, model or message
 *  id is kept. */
export type Meter = { name: string; at: number; window?: number; burn?: number[]; context?: number[] }

declare module 'claude-code' {
  interface PluginState {
    grimoire: {
      /** True while the pane is open. Nothing in the mod gates on it: the
       *  hooks read the open pane from the module's own timers. */
      armed: boolean
      start: Start
      files: Files
      roster: Roster
      rosterError: string
      live: Pair[]
      liveError: string
      links: Pair[]
      reports: Report[]
      dismissed: string[]
      doneTodos: string[]
      /** Ticked to-dos still inside their grace period: the to-do's id and
       *  the tick's time in epoch ms, as text. A second press removes one;
       *  the roster timer's sweep moves a due one to `doneTodos`. */
      ticking: Pair[]
      /** This session's last usage reading, read while the pane is open. */
      usage: UsageSnapshot
      /** This session's own session-limit percent, sampled from the usage
       *  readings while the pane is open, for its projection: at most one
       *  every 30 s, at most 120. Checked again before use. */
      samples: Sample[]
      /** Each roster member's cache warmth, from the agents poll while the
       *  pane is open. Checked again before it is drawn. */
      warmth: Warmth[]
      /** Each roster member's call series, from the same reads as its
       *  warmth. Checked again before it is drawn. */
      meters: Meter[]
      /** Each roster member whose summary file the agents poll refused: its
       *  name and a kind word, `path` (the path rule refused it) or `file`
       *  (the same file failed its checks two polls running). Read only
       *  through those two words. */
      refusals: Pair[]
      /** Each card's chosen tab: its title and a view word, `cache`, `burn`
       *  or `trend`, kept for the session and not reset when the pane opens.
       *  Read only through the fixed set of view words. */
      tabs: Pair[]
      /** The chosen view, `sessions` or `prs`: set to `sessions` each time
       *  /brigade opens the pane. Read only through the fixed set. */
      view: string
      /** The selected cards' titles, at most 50. Cleared when /brigade opens
       *  the pane. Checked again before use. */
      picked: string[]
      /** The folded groups, from the fixed set of six group keys: set to
       *  the finished group each time the pane opens, and flipped by a press.
       *  Checked again before use. */
      folded: string[]
    }
  }
}

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
}

/** Something waiting on the owner that no card already shows. */
export type Todo = { id: string; text: string; session?: string }

/** A lead session's roster file, after its shape check. */
export type Roster = { cards: Card[]; todos: Todo[] }

/** A report from another session: its claimed sender and first line. */
export type Report = { from: string; line: string; at: string }

/** A pair from a lookup, kept as a list so no key reaches a prototype. */
export type Pair = { name: string; value: string }

/** A session's last model call: when (epoch ms), its context in tokens when
 *  the transcript could be read, and its cache lifetime in ms. */
export type Warmth = { name: string; at: number; tokens?: number; ttlMs: number }

/** Where the roster file is, and the one before a clear or a resume. */
export type Files = { current: string; previous: string }

/** What the engine said at session start: the id and its transcript path. */
export type Start = { sessionId: string; transcript: string }

declare module 'claude-code' {
  interface PluginState {
    'brigade-native': {
      /** True once /brigade ran in this session: reports are kept from then. */
      armed: boolean
      start: Start
      files: Files
      roster: Roster
      rosterError: string
      live: Pair[]
      liveError: string
      links: Pair[]
      /** Session names whose transcript was read, found or not. */
      looked: string[]
      reports: Report[]
      dismissed: string[]
      doneTodos: string[]
      /** To-dos ticked but still shown, crossed out: id and the tick's epoch ms. */
      ticking: Pair[]
      /** Prototype (#193): each member's cache warmth, from its transcript. */
      warmth: Warmth[]
    }
  }
}

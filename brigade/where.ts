import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import {
  SESSION_ID,
  configFromRoot,
  configFromTranscript,
  dataFolder,
  dataId,
  marketplaceFromRoot,
  oneLine,
  rosterFile,
  statRejection,
} from './roster.ts'
import type { StatAnswer } from './roster.ts'

// Where the mod's files are, shared by the pane and the set_roster tool in
// register.tsx and by the usage summary writer in writer.ts.

// What the engine said at this session's start: its id and transcript path,
// set by register.tsx's `classic.SessionStart` hook through its own atom of
// the same key, since the engine reads each file's state by its own atoms.
const started = atom({ plugin: 'grimoire', key: 'start' } as const, { sessionId: '', transcript: '' })

// Where this lead session's roster file is, or why it cannot be named. The
// roster lives in the plugin's data folder, built by the plugin-manifest
// reference's rule from the config folder alone: <config>/plugins/data/<id>.
// `CLAUDE_PLUGIN_DATA` is never read: a mod's environment usually lacks it,
// and another plugin can set it. The config folder comes from where the plugin
// was installed, else from the transcript path the engine reported at this
// session's start; with neither, nothing is read or written. The config folder
// also locates other sessions' transcripts, and the writer's summary file.
export type Where = { file: string; config: string; plugin: string; id: string }
export async function where($: EngineInterface): Promise<Where | { error: string }> {
  const id = await $.session.id()
  if (!SESSION_ID.test(id)) return { error: 'the session id is not the engine\'s shape, so no roster file is named. Nothing was read.' }
  const start = await read($, started)
  const config =
    configFromRoot($.plugin.root) ??
    (start.sessionId === id ? configFromTranscript(start.transcript, id) : undefined)
  const plugin = dataId($.plugin.name, marketplaceFromRoot($.plugin.root))
  if (config === undefined) {
    return {
      error: `Cannot find the Claude config folder from where the plugin was loaded (${oneLine($.plugin.root, 200)}). The roster would be <Claude config folder>/plugins/data/${plugin}/brigade/${id}.json. Nothing was read.`,
    }
  }
  return { file: rosterFile(dataFolder(config, plugin), id), config, plugin, id }
}

// One `stat` for the path rule in roster.ts: resolving, and a rejection
// sorted into missing or failed by its message.
export function statOf($: EngineInterface): (path: string) => Promise<StatAnswer> {
  return path =>
    $.fs.stat(path, { resolve: true }).then(
      found => ({ found }),
      err => statRejection(String(err instanceof Error ? err.message : err)),
    )
}

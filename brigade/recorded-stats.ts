// Written by scripts/record-brigade-stats.mjs: what Claude Code's own
// `$.fs.stat(path, { resolve: true })` answered about each kind of real link,
// built for real in a temporary folder. `realPath` says where the answer's
// real path landed: the path itself, the link's target, or nowhere (absent).
// A rejection is its message, with the path and the plugin's name taken out.
// `list` is what `$.fs.list` answered for the folder holding them: the
// fields each entry carried, and each entry's kind and isLink by its name.
// Do not edit by hand; run the script with --write.

export const RECORDED = {
  engine: "2.1.296",
  platform: "win32",
  stats: {
    folder: {
      kind: "dir",
      isLink: false,
      realPath: "self"
    },
    file: {
      kind: "file",
      isLink: false,
      realPath: "self"
    },
    junction: {
      kind: "dir",
      isLink: true,
      realPath: "target"
    },
    "broken-junction": {
      kind: "other",
      isLink: true,
      realPath: "none"
    },
    "dir-symlink": {
      kind: "dir",
      isLink: true,
      realPath: "target"
    },
    "file-symlink": {
      kind: "file",
      isLink: true,
      realPath: "target"
    },
    "broken-file-symlink": {
      kind: "other",
      isLink: true,
      realPath: "none"
    },
    "hard-link": {
      kind: "file",
      isLink: false,
      realPath: "self"
    }
  },
  rejections: {
    missing: "<plugin>: $.fs.stat(<path>) failed: ENOENT",
    "under-junction": "<plugin>: $.fs.stat(<path>) failed: ENOENT",
    "under-file": "<plugin>: $.fs.stat(<path>) failed: ENOENT"
  },
  list: {
    fields: [
      "isLink",
      "kind",
      "mtimeMs",
      "name",
      "size"
    ],
    entries: {
      "broken-file-symlink": {
        kind: "other",
        isLink: true
      },
      "broken-junction": {
        kind: "other",
        isLink: true
      },
      "dir-symlink": {
        kind: "other",
        isLink: true
      },
      file: {
        kind: "file",
        isLink: false
      },
      "file-symlink": {
        kind: "other",
        isLink: true
      },
      folder: {
        kind: "dir",
        isLink: false
      },
      "hard-link": {
        kind: "file",
        isLink: false
      },
      junction: {
        kind: "other",
        isLink: true
      },
      "target-dir": {
        kind: "dir",
        isLink: false
      },
      "target-file.txt": {
        kind: "file",
        isLink: false
      }
    }
  }
} as const

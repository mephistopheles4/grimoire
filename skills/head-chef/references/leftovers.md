# Leftover files (questions 3, 5, 18)

This file is generated from `CONTRACT.md` in the skill base directory, with
`SKILL.md`. The head chef reads it once, at its first launch in a session.
Reason: head-chef 0.4.0's relay scripts could leave data on disk with nothing
to remove it, an interrupted record act can leave its post file, and a
background plugin update never shows the README (failure 16).

Check once for three kinds of file:

- the state folder `plugins/data/grimoire-relay/` under the config folder:
  `CLAUDE_CONFIG_DIR` when it is an absolute path (a drive letter with a
  separator, or a leading separator, as 0.4.0 read it), and otherwise the
  home folder's `.claude`;
- files named `grimoire-relay-*.md` in every temporary folder that `TEMP`,
  `TMP` or `TMPDIR` names, and in the system's own temporary folder;
- files named `grimoire-act-*.txt` in the same temporary folders: a record
  act's post file, which an interrupted act left.

**Let the shell read the variables itself; never type their values into a
command.** Reason: a value the model types into a command can run as one
(failure 3). In PowerShell, which these lines suit in both Windows
PowerShell and PowerShell 7:

```powershell
$base = if ($env:CLAUDE_CONFIG_DIR -match '^([A-Za-z]:[\\/]|[\\/])') { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
Test-Path -LiteralPath ([IO.Path]::Combine($base, 'plugins', 'data', 'grimoire-relay')) -PathType Container
@($env:TEMP, $env:TMP, $env:TMPDIR, [IO.Path]::GetTempPath()) | Where-Object { $_ } | Sort-Object -Unique | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter 'grimoire-relay-*.md' -Name -ErrorAction SilentlyContinue }
@($env:TEMP, $env:TMP, $env:TMPDIR, [IO.Path]::GetTempPath()) | Where-Object { $_ } | Sort-Object -Unique | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter 'grimoire-act-*.txt' -Name -ErrorAction SilentlyContinue }
```

In a POSIX shell, `test -d` on the same folder, with the variable expanded
inside double quotes, and the same listings of each temporary folder.

- **When the state folder or a relay post file exists,** tell the owner in
  one line, in this chat only, never on a record, a roster card or a to-do:
  leftover relay files from 0.4.0 are on this machine; the README says how to
  delete them, after checking that the folder is a plain folder and not a
  link or a junction, and to restart every session started under 0.4.0.
- **When a record act's post file exists,** tell the owner in its own line,
  in this chat only: a post file from an interrupted record act is on this
  machine; it may hold text the owner asked to post; the README says to
  delete it by hand.
- **Delete none of them.** Reason: the head chef deletes no file but its own
  post file, right after its act, and cleanup's worktree (failure 2).
- **When a read fails, or asks for permission,** skip the check and say
  nothing.

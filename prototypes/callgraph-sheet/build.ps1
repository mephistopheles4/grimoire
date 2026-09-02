# build.ps1 — assemble index.html from view.html + the real sources.
#
# Nothing is transcribed. drafting.css and the three IBM Plex Mono weights are
# read from the design system itself; the programs are read off disk. The output
# is one file with no network references at all — which was the point: a CDN
# link is a dependency on someone else's uptime and a claude.ai artifact will
# not load one.
#
# THE VM IS NO LONGER SPLICED. It used to come out of D-00 by line range, and
# #28's amendment retires it from read time: D-01 plays a recorded walk instead.
# The VM did not die, it moved — record.mjs lifts it from D-00, runs it once and
# writes the tape into each program. So this script REFUSES a program whose
# walks are stale rather than emitting a page that steps over yesterday's IR.
#
#   pnpm exec prettier --write prototypes/callgraph-sheet/index.html   # after

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ds = Join-Path $env:USERPROFILE 'WebstormProjects\aymandiab.com\design-system'

if (-not (Test-Path $ds)) { throw "missing source: $ds" }

# -- fonts: the vendored binaries, inlined -----------------------------------
$faces = foreach ($w in 400, 500, 600) {
  $file = Join-Path $ds "fonts\ibm-plex-mono-latin-$w-normal.woff2"
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))
  @"
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: $w;
  font-display: swap;
  src: url(data:font/woff2;base64,$b64) format('woff2');
}
"@
}
$fonts = ($faces -join "`n")

# -- drafting.css: verbatim ---------------------------------------------------
$drafting = Get-Content -LiteralPath (Join-Path $ds 'drafting.css') -Raw

# -- the walks must be current -----------------------------------------------
# A page that steps over a walk recorded against an older IR is the exact
# failure the provenance stamp exists to make visible, so it is caught here
# rather than drawn.
& node (Join-Path $here 'record.mjs') --check | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'walks are stale — run: node prototypes/callgraph-sheet/record.mjs'
}

# -- programs on disk: the real ones, drawn off actual pull requests ----------
# This is the skill's output format. An agent reads a diff and writes one of
# these — the graph AND the walk over it; the viewer is what plays it. They are
# appended rather than compiled in, so adding an example is a file, not an edit.
$dir = Join-Path $here '..\programs'
$extra = @()
foreach ($f in Get-ChildItem -LiteralPath $dir -Filter '*.json' | Sort-Object Name) {
  $json = Get-Content -LiteralPath $f.FullName -Raw
  try { $null = $json | ConvertFrom-Json } catch { throw "$($f.Name) is not valid JSON: $_" }
  $extra += "PROGRAMS.push($json);"
}
if (-not $extra.Count) { throw "no programs in $dir — the page would have nothing to draw" }
$programs = @"
/* The programs, read from prototypes/programs/*.json by build.ps1. Each one
   carries its own recorded walk; nothing on this page computes a next state. */
let PROGRAMS = [];
$($extra -join "`n")
"@
"  + $($extra.Count) program(s) from prototypes/programs/"

# -- splice -------------------------------------------------------------------
$out = Get-Content -LiteralPath (Join-Path $here 'view.html') -Raw
foreach ($pair in @(
    @{ token = '/* __FONTS__ */'; value = $fonts },
    @{ token = '/* __DRAFTING__ */'; value = $drafting },
    @{ token = '/* __PROGRAMS__ */'; value = $programs }
  )) {
  if ($out -notmatch [regex]::Escape($pair.token)) { throw "placeholder not found: $($pair.token)" }
  $out = $out.Replace($pair.token, $pair.value)
}

# -- refuse the four names that kill a classic script silently ---------------
# `window`, `document`, `location` and `top` are non-configurable own properties
# of the global object, so a top-level `let`/`const` of that name is a
# SyntaxError raised at script instantiation — before the first statement. The
# script parses, never executes, and leaves a page of static markup with nothing
# in it. It cost an afternoon: `new Function()` and `eval` both create a scope
# where the shadowing is legal, so every way of testing it says the code is fine.
$forbidden = 'window', 'document', 'location', 'top'
$clashes = [regex]::Matches($out, '(?m)^\s{6}(?:let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)') |
  ForEach-Object { $_.Groups[1].Value } |
  Where-Object { $forbidden -contains $_ }
if ($clashes) {
  throw "top-level lexical declaration shadows a non-configurable global: $($clashes -join ', '). Rename it — the page would render blank."
}

$target = Join-Path $here 'index.html'
Set-Content -LiteralPath $target -Value $out -NoNewline

# Formatting is a courtesy here, not a gate. These files were written inside the
# `stacks` checkout, whose CI runs `prettier --check .` over the whole tree; this
# repository is zero-dependency and has no prettier at all. So the step runs when
# one is reachable and is skipped, out loud, when it is not — a build that refused
# for want of a formatter would be the wrong kind of strict.
Push-Location (Join-Path $here '..\..')
try {
  pnpm exec prettier --write --log-level warn 'prototypes/callgraph-sheet/index.html' 'prototypes/callgraph-sheet/view.html' 'prototypes/programs/*.json' 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { '  (no prettier reachable — output left unformatted)' }
}
catch { '  (no prettier reachable — output left unformatted)' }
finally { Pop-Location }

"{0}  —  {1:N0} KB" -f $target, ((Get-Item $target).Length / 1KB)

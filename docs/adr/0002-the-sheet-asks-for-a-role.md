# The sheet asks the design system for a role, never for a mark colour

A call-graph sheet reports two conditions — something broke and has not
resolved, and it resolved — and the design system now names them: `--av-path`
and `--av-path-caught`, with `--av-state-rule` for the stroke that carries walk
state. `groundtrack` asks for those roles everywhere it used to reach for
`--av-caution` and `--av-normal`. The two are the same amber and green in the
deck theme, so most of this is invisible; the point is the theme that answers
differently. In the site theme caution folds to plain ink, so a sheet asking for
caution got nothing where it needed a mark most, and asking for the path gets
redline — which is what an error in flight actually is.

## Considered Options

**Colour by node role was asked for, and is declined.** Issue #77 reported the
tree as hard to scan and asked for hue by node type. The answer is no, and it is
measured rather than tasteful. Under deuteranopia this palette has one axis,
yellow to blue: amber and green sit at the yellow end 1.16:1 apart, and syntax
sits at the blue end. Every candidate fifth hue lands within 1.34:1 of something
already in use, and violet lands on syntax at 1.03:1. Amber and green survive
that gap only because each carries a glyph and there are two of them. A node's
role is also an **open vocabulary** — any word, which the page prints and
nothing branches on — so there is no closed set to assign hues to even if there
were hues to spend. The answer to a sheet that reads monochrome is these two
hues **in more places**, never more hues, which is what the effect-outcome chip
and the path stripe are.

**Adding a token in the tool was rejected.** #79 forbade it and this keeps that
rule: the sheet declares no colour of its own. A role that only groundtrack
needs is still a system-wide decision, because the value it resolves to has to
differ per theme, and only the theme knows what it carries.

**Replacing `state` with a fourth value was rejected** in favour of a second
field. The tree now tells the frame the walk is *in* from the frames waiting
under it, which is most of the rows on a deep stack. Making that a fourth
`state` would have changed what `--text` prints and what the checks read, for a
distinction only the page draws. `top` is a boolean beside `state`, and `path`
is one word beside the full `error.how`, for the same reason: the marks that can
only say one thing get their own field, and the exhaustive record stays.

## Consequences

**`caught` is a colour now, and in the deck theme it is green.** #84 drew it in
full ink only because it had no token to reach for. Where the path stops is
exactly what `path-caught` names, and the same role paints an effect that
landed, so a listing and the tree beside it mark one outcome the same way. In
the site theme it folds back to ink, as green is not part of that theme and a
walk sheet is not a licence to import one.

**No position depends on hue, and this is load-bearing.** Each carries three
channels: a stripe inset down the row's left edge, a glyph before the name, and
the word itself in a chip after it. Read the sheet in one ink and the path is
still a path. The stripe sits on the left and not the right — a reader enters a
row at its left edge — just inside the walk-state border, which is drafting
order: the object outline outermost, its annotation within.

**One consequence accepted rather than overlooked**, and the design system's own
note anticipates it: in the site theme the state rule and the caught stripe are
both ink, so on a row that is both the running frame and the one that caught,
the two abut into a single bar and stop being separable. The glyph and the word
carry the position there, which is the whole reason every position has a second
channel.

**The drawing keeps its own on-stack outline at ink 30**, which measures 1.86:1
and is under the 3:1 a stroke carrying a signal is held to. That is a real
defect and it is not this change: #79 promised the drawing unchanged, and moving
it belongs with the drawing's own linework rather than with the tree's.

**One word per row is read off the filtered path, never off the fold's raw
entries.** The fold records a throwing frame twice — thrown, then passed through
as it unwinds — so the last raw entry for that site says *passed through* and
would strip the mark off the one row a reader looks for first.

# Parity with the design

Three checks, each answering a question the others cannot.

```bash
python3 scripts/parity/stylesheet.py '<design>/tlon.html'   # every rule, every value
python3 scripts/parity/typography.py '<design>/tlon.html'   # every font declaration
python3 scripts/parity/states.py '<design>/tlon.html'       # every hover/focus rule, and whether it can fire
node   scripts/parity/shape.js                              # run in the page; see below
python3 scripts/parity/copy.js                              # likewise
```

`shape.js` and `copy.js` are evaluated in the browser against both the design
(served over http, since its module script will not run from `file://`) and the
app, and the two outputs diffed. `shape.js` records each styled node's parent
path, so it catches what a class-set diff cannot: the design nesting
`#dock > #cap > textarea` where a port put the id on the textarea itself, same
classes, different tree, every descendant rule silently not matching.

`states.py` is the fourth check, and it exists because the third was not enough.
`.f-field` was declared identically on both sides and inert in this app for
weeks: the class sat on the input instead of the wrapper the rule was written
for, so a rule-level diff saw agreement and nothing ever applied it. This lists
the design's 52 stateful rules, reduces each to a base selector, and counts
matches in both live pages. A selector the design matches and the app never does
is a state the app cannot enter.

It found two, and the more useful one was not a style bug at all — see the
identity note below. The other was the talk input, which turned out to be a flaw
in the sweep: the input is behind BEGIN THE CONVERSATION on both sides, and the
sweep never pressed it. Entering the state on both sides, the two are identical.

`copy.js` compares the authored words — headings, captions, section labels,
button text — with the record's own words and anything mostly numeric filtered
out. Run across every route it comes back clean except where the difference is
the point: settings says "Three switches and a way out" because this app has
three, and the dated and timezoned lines differ because the two are looking at
different records.

It found two things worth having. The kicker on the two static screens read
`BEFORE YOUR FIRST ENTRY NEW` where the design reads `BEFORE YOUR FIRST ENTRY ·
NEW` — the `.new` span is styled only inside the rail, so on those screens it
did nothing but swallow the separator. And `START WRITING` had picked up a `→`.
The design keeps arrows for moving along the timeline — `NEXT →`, `THU →`, `the
pattern →` — and that button is an action, not a step.

## Where it stands

Stylesheet and typography are exact: 313 selectors and 26 font declarations,
nothing on either side the other lacks. `:root` lives in `packages/design` and
its fourteen values were checked separately.

Shape now reports structure and ids apart. Nearly every id in the design is a
handle for its own imperative JS — `#wpeek`, `#qcount`, `#newx`, `#capState` —
and React replaces those with state, so counting them as structural differences
buried the real ones. Settings read as four differences when its tree is
identical to the design's, and the one difference that mattered on graph read as
the same size as three id hooks beside it.

```
route                        structure   ids
agents, first, words                 0     0
journal, week, experiments           0     1
search                               0     2
settings                             1     3   knob is a button here
explore                              1     0   deliberate
graph                               10     0   deliberate, all of it
login                                –     –   rail; see below
patterns                             5     0   data — 0 with an ordering present
identity                             4     1   data — 0 on an account holding all four ring states
today                                7     0   data — no entry written today
talk                                 5     8   before the conversation is begun
```

Graph's ten are two element swaps and nothing else: nine `div.card` → `a.card`,
one `span.pill` → `button.pill`. Both are the same decision as settings' knob —
where the design shows a thing, this app makes the thing itself the control, so
it can be reached with a keyboard.

Login's thirteen are mostly one thing: the design has no auth, so its rail is on
every route including this one. A signed-out person gets no rail here, and the
chrome skips `#app` with it — that grid exists to seat the rail, and a lone
`#screen` in its `auto` track shrinks to its own content.

The deliberate ones, so they are not re-litigated:

- **explore** labels nodes on hover; the design labels all of them with `<text>`.
  A hundred names laid over each other is less legible than none.
- **graph** makes the whole card a link; the design uses a `<div>` with the link
  on its label. Identical to look at, more of it clickable.
- **experiment** check-in rows are rows with linked words, not links, because a
  running trial puts a button on that row and a button cannot sit inside a link.
- **login** keeps SIGN IN and CREATE AN ACCOUNT where the design has one
  CONTINUE, and says twelve characters where the design says eight, because
  `MIN_PASSWORD_LENGTH` is twelve. One button has to guess which you meant, and
  guessing wrong on a mistyped address makes a second empty account instead of
  saying the password was wrong.
- **the decay model.** The design describes readings that fade as they go
  unlooked-at, in two places: the `hrön · unobserved 34 days — growing vague`
  line under a dashed card, and the closing clause of the Headspace note,
  "fainter where still tentative, and fading where no one has looked". This
  backend has no such model — `tentative` is confidence below 0.5 and nothing
  else — so the app keeps the first with a true reason and drops the second
  clause entirely. Both are the same decision: say what is so, not what the mock
  said.
- **tentative graph cards** carry a line under them saying why they are dashed,
  as the design does. The design's says `hrön · unobserved 34 days — growing
  vague`, which belongs to a model where a reading decays as it goes unseen.
  This backend has no such model: `tentative` is confidence below 0.5 and
  nothing else. The line stays, with the reason that is true here. Fabricating a
  day count would have matched the design exactly and said something false.
- **reduced motion** covers Patterns and Experiments here and does not in the
  design. Its rules reach `.scr` and the journal; `.p-row` and `.x-row` sit
  outside both, so with the setting on, the design still scales forty bars and
  pops six seals on Patterns alone. Checked side by side: under `reduce` the
  design reports `pBar, pSeal` and this app reports nothing. Reduced motion is
  not a preference about taste — it is what someone with vestibular trouble sets
  so software does not make them ill — so this one stays diverged.

One that was filed under "data" was not. `.id-ring.tent` never appeared, and the
note here said the account could not produce a kept ring. It could: it held one,
and the composition was not drawing it. Rings were sorted by confidence and cut
at seven, and extraction is surest about the most literal things — thirty-nine
offered readings outranked the single reading this person had confirmed, so a
screen headed "Drawn from everything you kept" drew seven activities like *took
the stairs* and none of what they kept. Kept readings now come first. This is
the second time something recorded here as unreachable was reachable, and both
times the record was the thing at fault, so treat that phrase as a claim needing
evidence rather than a conclusion.

The two-sided strip was the third. This said it could not be reached at all, on
the evidence that twelve bad nights each followed by a foggy morning produced no
ordering. The observation was real and the conclusion was wrong: those nights
were extracted as Events and Thoughts, and `PATTERNABLE_KINDS` holds neither, so
they were never eligible however they were timed. Twelve orderings already
existed in the database when this was written. On one of them the app shows
`sleeping badly came up 1 day before foggy · 4 of 5 times`, and its second-side
bar measures identically to the design's — same fill, height, width, opacity and
cell.

The identity states were the last, and they were reachable too — on a fixture
account, by keeping one candidate. All five ring variants render there: kept,
offered, tentative, tombstone and the core. Every one matches the design on
stroke, width and opacity.

Looking at them found two divergences that no amount of measuring the default
state would have:

- **Offered rings were drawn with one loop, not two.** The design's rule is
  `gone || tentative ? 1 : 2` — detail stands for how sure the *reading* is.
  This app gave the second loop only to readings the person had kept, so a
  confidently offered one was drawn as faintly as a doubtful one: the picture
  said "you have not answered this yet" using the mark that means "the record is
  unsure".
- **The core was drawn on with the same stroke animation as the readings.** The
  design excludes it (`.id-ring:not(.id-core)`) and leaves you already there
  while the readings accumulate around you. That is the right way round.

Identity's shape diff is now one line, and it is the `id="idCap"` the design's
imperative caption needs and React state replaces — a script hook, like the
journal's.

## The other client

`tokens.py` checks the palette across three sources — the design's `:root`,
`packages/design/tokens.css` which the web client imports, and `tokens.ts` which
the mobile client imports. Fourteen values, three sources, no disagreement.
`stylesheet.py` exempts `:root` on the grounds that it was "checked separately",
and separately meant once, by hand, which is not a check but a memory of having
looked.

The palette agrees. The mobile client largely does not use it. `theme.ts` reads
the shared tokens and maps them onto its own names, and then **177 colour
literals across 13 files bypass it** — 42 distinct values, most of them the old
palette: `#a09db4` and `#f1f0f8` for ink, `#08080c` and `#12121c` for ground,
against the design's `#eef1ec` on `#0a0d0c`. So "both clients take the design
from one source" is true of the file that names the colours and false of the
screens that draw them.

One of those is not stale hexes but a different idea. `Constellation.tsx` gives
each of the eleven node kinds its own colour — Thought cyan, Emotion pink, Need
amber. The design has no per-kind colour map anywhere, and the web client
colours a graph node by what is *known* about it: `kept` when confident, a
`sand` outline when tentative. Colour in this design marks live, kept, pattern
or wrong — never taxonomy. Reconciling that is a design decision, not a
find-and-replace, so it is written down here rather than guessed at.

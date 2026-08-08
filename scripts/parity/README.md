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

## Where it stands

Stylesheet and typography are exact: 313 selectors and 26 font declarations,
nothing on either side the other lacks. `:root` lives in `packages/design` and
its fourteen values were checked separately.

Shape, across every route, with script hooks excluded:

```
week, experiments, agents, search, settings, first, pattern, talk    0
journal, node, words                                                 1   script hook only
explore                                                              1   deliberate
graph                                                                7   deliberate
login                                                               13   rail + deliberate
identity, patterns, today                                            5-6 data
```

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

That leaves one: a tentative finding with nothing drawn from it. Given the
record above, treat it as untested rather than unreachable.

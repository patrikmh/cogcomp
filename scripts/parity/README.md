# Parity with the design

Three checks, each answering a question the others cannot.

```bash
python3 scripts/parity/stylesheet.py '<design>/tlon.html'   # every rule, every value
python3 scripts/parity/typography.py '<design>/tlon.html'   # every font declaration
node   scripts/parity/shape.js                              # run in the page; see below
python3 scripts/parity/copy.js                              # likewise
```

`shape.js` and `copy.js` are evaluated in the browser against both the design
(served over http, since its module script will not run from `file://`) and the
app, and the two outputs diffed. `shape.js` records each styled node's parent
path, so it catches what a class-set diff cannot: the design nesting
`#dock > #cap > textarea` where a port put the id on the textarea itself, same
classes, different tree, every descendant rule silently not matching.

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
identity, patterns, today                                            5-6 data
```

The deliberate ones, so they are not re-litigated:

- **explore** labels nodes on hover; the design labels all of them with `<text>`.
  A hundred names laid over each other is less legible than none.
- **graph** makes the whole card a link; the design uses a `<div>` with the link
  on its label. Identical to look at, more of it clickable.
- **experiment** check-in rows are rows with linked words, not links, because a
  running trial puts a button on that row and a button cannot sit inside a link.

The data ones need states this account cannot produce: an identity ring that is
*kept* rather than offered, a tentative finding with nothing drawn from it, a
strip with two sides. That last one cannot be reached at all — see
`scripts/simulation/README.md`: twelve bad nights each followed by a foggy
morning produced no ordering, because the extractor gave the same sentence
different kinds on different days. `stripSeries` is unit-tested instead.

# A fortnight, simulated

`a_fortnight.py` writes twenty-six entries across fourteen days for one person,
and `what_it_concluded.py` prints what the app made of them.

The entries are written the way someone would actually write them. A reader
would summarise the fortnight as *avoids crowds, will not look at money,
frightened about children* — and nothing in the text names any of those. That
is the point: the question is whether the app arrives at the same reading from
the entries alone.

```bash
python3 scripts/simulation/a_fortnight.py "$TOKEN"
curl -s -X POST -H "Authorization: Bearer $TOKEN" localhost:8080/v1/patterns/mine
python3 scripts/simulation/what_it_concluded.py "$TOKEN"
```

## What it found, 2026-08-07

Extraction reads the person well: "to not be around other people", "A morning
that starts without checking money", "Cannot stop thinking about whether we can
afford a child" are all drawn from entries that say none of those things.

The pattern layer then loses all of it. Of 130 readings there are 121 distinct
labels, and `exact-label` — which needs the same string twice — finds four
repeats, of which the strongest is a person's name. So "What keeps returning"
answers **Ida**, while the twenty-one readings that are plainly one behaviour
(`took the stairs`, `stayed in the kitchen`, `walked to the far shop again`,
`Ate lunch at my desk rather than the canteen`, `said no to the pub`) return
nothing, because no two of them are worded alike.

Identity inverts the same way. It is surest about `did the washing up twice`
(0.92) and least sure about `to not be around other people` (0.45), because
confidence tracks how literally a thing was stated rather than how much it says
about someone — and the screen sorts by confidence.

`does_the_arithmetic_hold.py` is the other half: it files every entry on the
record by its **local** day and asks the day and week reads for the same totals.
Run it against any account.

It passes on the fortnight, including the three entries written after midnight
UTC — 22:15, 22:40 and 23:05 UTC are 00:15, 00:40 and 01:05 the next morning in
Stockholm, and all three are filed on the day the person actually lived them.
That is the bug class worth guarding: file an entry under the wrong day and
every count above it is quietly wrong, on every screen, forever.

Keep this fixture. It is the smallest thing that shows the gap between what the
extractor understands and what the pattern layer can see.

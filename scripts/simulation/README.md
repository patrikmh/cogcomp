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

## The whole sweep, against this fortnight

Working, checked end to end: signup and sign-in; writing and extraction; search
with highlighting; the complete experiment arc — created, started, checked in
with an ordinary journal entry, completed with an assessment and a note; keeping
and judging a reading; the four headspace lenses; the graph and explore reads;
the day and week reads; agent runs reporting honestly, including themes
declining to form a region and saying why; turning findings off and on, which
says plainly that nothing has been deleted.

Sign-out revokes the token on the server, not only in the browser: the old
bearer answers 401 afterwards, which is what Settings claims it does. Both
clients reach the same conclusion from the same account — the web says "1 held",
the mobile app "1 thing recurred".

What does not add up is above, and it is all one shape: extraction understands
this person, and every layer built on top of it loses that understanding.

## Which of the three threads survive each layer

`which_threads_survive.py` asks every layer, in turn, whether it can see each of
the three things the fortnight was written to carry.

```
                          readings  patterns  identity  own words  regions
keeping away from people        29         0        13          5        0
not looking at money            16         0         6          2        0
frightened about a child         9         0         0          0        0
```

Two readings of that table.

**Nothing reaches patterns or regions.** All three threads, invisible. The one
pattern the app does hold is a person's name.

**The third thread reaches nothing at all past extraction** — and the reason is
structural, not a matter of confidence. Its nine readings are four Events, two
Thoughts, two People and a Place. Identity considers Activities, Needs and
Values. There is no overlap, so the fortnight's most frightened material —
`Cannot stop thinking about whether we can afford a child` at 0.95,
`Ida asked when we are going to start trying` at 0.93 — cannot be offered as
part of who this person is, while `did the washing up twice` can.

The other two threads survive only because the extractor happened to phrase them
as Needs: `to not be around other people`, `A morning that starts without
checking money`. Had it written those as Thoughts, they would have vanished too.

So whether something becomes part of "who you are" is decided by the part of
speech the extractor reached for. Nobody chose that.

## What changes at five weeks

`three_more_weeks.py` extends the diary backwards so the detectors have enough
to speak. Five of the six will not claim anything on a fortnight — periodicity
wants four distinct weeks, lag and same-day want three, the stated-against-
recorded one wants ten observed days. On two weeks they can only abstain, which
is the right call and an invisible one: the screen says nothing has come back
often enough, and never that most of this needs about a month.

At two weeks the app finds **one** pattern. At five it finds **ten**.

```
                          readings  patterns  identity  own words  regions
keeping away from people    29→54       0→3     13→25       5→10        0
not looking at money        16→32       0→2      6→11        2→3        0
frightened about a child      9→13       0→0       0→0        0→0        0
```

So the first two threads do arrive, given a month. `took the stairs`,
`walked the long way to the shop`, `the market`, `the canteen` are all found —
as four separate patterns, never as the one thing a person would call them.

The third thread does not arrive at any volume, and that is the finding worth
keeping. Thirteen readings across five weeks and it appears on no screen but
the graph. Not a threshold: its material is Events, Thoughts, People and Places,
Identity takes Activities, Needs and Values, and no amount of further diary
changes which kind a sentence was extracted as.

Every one of the ten patterns is `exact-label`. The other five detectors still
abstain at five weeks, correctly — this diary has no weekday regularity and no
lag structure to find.

## Why no regions form, and why that is not a bug

At five weeks the association layer finds **one** pair from 240 candidates, and
a region needs a group, so no region forms. It is worth writing down why,
because the obvious explanation is wrong.

I expected consolidation to be leaving duplicate readings behind and starving
the pair counts. Thirteen labels do appear twice in the graph. Twelve of them
are not duplicates at all:

- **Ten** are a `Pattern` node sitting beside the reading it summarises —
  `took the stairs` the Activity, and `took the stairs` the pattern. Consolidation
  excludes `Pattern` by design, and should.
- **Two** are the extractor giving the same words two kinds on different days —
  `slept badly again` as a Thought once and an Event another time; `ate lunch at
  my desk rather than the canteen` as a Thought and an Activity. Consolidation
  groups on `(kind, label)`, so these do not meet.
- **One** — `to not be around other people`, twice as a Need — is the only one
  consolidation could have merged, and it did not because that node was *kept*.
  Kept readings are protected from consolidation, which is precisely what the
  Identity screen promises.

So the association layer is not starved. It is strict: `MIN_LIFT = 2.0` means a
pair has to occur together *disproportionately*, not merely often. This person
drinks coffee most mornings and wakes early most mornings, so the two co-occur
constantly and predict each other barely at all. Declining to call that an
association is the correct answer.

Which leaves the extractor's kind inconsistency as the only real defect found
here, and a small one: two labels out of a hundred and eighty-four.


# Tlön — what the app is, every screen in it, and the design it is built from

A brief for another model asked to design, extend or critique this app. It
describes the product as it exists on 2026-08-04. Navigation mechanics are in
`docs/NAVIGATION.md`; the epistemic rules behind the machinery are in
`docs/PRODUCT_SPEC.md` and the ADRs.

---

## 1. The goal

**A private journal that notices things about you that you cannot notice from
inside your own life, and can prove every one of them.**

Someone writes or speaks entries. A model extracts structured readings from
them — emotions, needs, values, beliefs, people, places, activities, thoughts —
each with a confidence score and a link back to the exact words it came from.
Background detectors then look for shape across time: what recurs, what recurs
on a particular weekday, what tends to follow what, what travels together, which
regions of a life cluster, and what someone names as mattering while their days
contain something else.

The target experience is the kind of noticing that normally takes a long quiet
sit — *"oh, that keeps happening"* — arrived at from evidence rather than from
introspection. It is emphatically **not** a meditation app, a mood tracker, or a
therapist. It never diagnoses, never scores, never advises.

## 2. Five commitments that constrain every design decision

Design that violates these is wrong however good it looks.

1. **Every claim is traceable.** Any inference can be opened to see the entries
   that produced it. This is why `/node/[id]` is reachable from nearly every
   screen, and why "Where this came from" is a screen title rather than a
   tooltip.
2. **A guess must never look like a fact.** Below 0.5 confidence a reading is
   *tentative* and rendered differently — hollow rather than filled, in its own
   section ("Less sure about", never mixed into "Noticed").
3. **The person can disagree, and disagreement has consequences.** Any reading
   can be confirmed, rejected or un-judged. A rejected reading stops feeding
   patterns, temporal comparisons and the graph projection — and the UI says so
   at the moment of rejection, because that consequence is what makes the tap
   worth making.
4. **Silence is information, and is never punished.** Empty days say "nothing
   recorded" and stop. No streaks, no reminders, no "you haven't written in a
   while", no encouragement to produce more material.
5. **Counts, not verdicts.** Findings are phrased as arithmetic the person can
   check — "came up on 9 days … never in the same entry" — never as an
   interpretation of what that means about them.

## 3. Visual language

**A quiet dark room with small emissive signals.** That single sentence from
`src/theme.ts` explains most of the styling: near-black grounds, dim structural
lines, and colour used only where something is *live*.

| token | value | role |
|---|---|---|
| `room` | `#08080c` | page ground |
| `roomRaised` / `surface` / `surfaceBright` | `#0e0e16` / `#12121c` / `#181827` | stacked panels |
| `line` / `lineStrong` | `#29293b` / `#454563` | borders, dividers, quiet marks |
| `ink` / `inkSoft` / `inkMuted` | `#f1f0f8` / `#b5b3c7` / `#a09db4` | primary, secondary, meta text |
| `cyan` `#67e8f9` | live, confident, section kickers |
| `violet` `#a78bfa` | primary actions, identity |
| `pink` `#f0abfc` | headspace |
| `warning` `#fbbf24` | tentative, skipped |
| `danger` `#fb7185` | failure, rejection |

Type is a small scale: 25/700 titles, 16/23 body, 12 meta, and 11–12 uppercase
kickers with wide letter-spacing (`1.4`–`1.8`) for section labels. Radii are
tight (3px on surfaces and inputs, 999 on pills). Borders are 1px and dark;
elevation comes from ground shifts, not shadows.

Two structural signatures:

- **Points, not rows.** Most screens draw their content as a field of dots
  (Skia or laid-out views) where **size carries weight** — how often something
  recurred, how busy a day was — and **fill carries certainty**: filled for
  observed or confident, hollow for tentative. Tapping a point reads it out
  below. Lists survive only where the distinction between groups matters.
- **A head-shaped frame.** Several screens sit inside a skull-profile silhouette
  or a sphere, drawn in Skia with a deterministic layout seeded from node ids —
  the same graph always settles the same way, so spatial memory works.

Motion is a shared `MotionSurface` press treatment; there are no attention-
seeking animations, no toasts, no celebratory states.

## 4. Composition patterns to reuse

- **`Observatory`** — eyebrow, a field of points, a readout for the selected
  point, an optional hint, one primary action and one secondary. Used by
  Headspace, Identity, Patterns, Agents, Explore. Its `Readout` deliberately
  shows at most three facts; a fourth belongs on the screen you tap through to.
- **`AtmosphericShell`** — animated backdrop plus the bottom dock, used by the
  Journal-adjacent and detail screens.
- **`EvidenceRail`** — a spine with entries hanging off it, used wherever the
  chain from claim to the person's own words is shown.

## 5. Every reachable screen

| Screen | Route | What it is for | What is deliberately absent |
|---|---|---|---|
| **Login** | `/login` | Email + password, the only screen outside the auth gate | any marketing; no explanation of what a journal is |
| **Journal** | `/` | Writing, first: the composer sits under the thumb, entries are the sky above it. Hold to record for voice | nothing stacked above the input |
| **Today** | `/today` | One day as a single turning shape — entries heavy and filled, inferences slight and hollow — plus "Noticed" and "Less sure about" | no mood score, no trend |
| **This week** | `/week` | Seven cells, each as bright as it was busy, so the week's *rhythm* is the first thing seen. Empty days stay visible, drawn dim | no "you should write more" |
| **Headspace** | `/headspace` | Where things stand, through four lenses — Today / Everything / Recurring / Changed — that repopulate one picture instead of navigating | no lens that combines them into a verdict |
| **Identity** | `/identity` | Everything ever suggested about you, at once. What you kept is lit, what is merely suggested is hollow; only your tap moves it | no profile summary, no "you are X" |
| **Patterns** | `/patterns` | What keeps returning. Point size is recurrence relative to your own busiest pattern | no absolute scale, no ranking against other people |
| **What came first** | `/pattern/[id]` | For ordered (lag) findings only: each occasion as *First → N days later → Then*, with the non-causal framing stated above the evidence | no causal language anywhere |
| **Talk it through** | `/talk` | A conversational agent whose job is to help you say what you mean; only your turns become entries. Voice-driven, with a blob avatar that moves with the speech envelope | no interpretation — that stays downstream and schema-constrained |
| **Where this came from** | `/node/[id]` | The explain screen: the claim, its confidence as a meter with the 0.5 threshold marked, Yes / Not really, the evidence chain, and how it was produced | no way to see a claim without its provenance |
| **Experiments** | `/experiments` | Self-authored trials: hypothesis, action, success criterion, cadence | no app-suggested experiments, no score |
| **Experiment** | `/experiment/[id]` | One trial's lifecycle, linked Pattern evidence, journal-backed check-ins, and a qualitative outcome you choose | no verdict on whether it "worked" |
| **Graph** | `/graph` | Dashboard: counts by kind, filters, a way into any node *(dev)* | not a force-directed picture — it looks impressive and says little |
| **Explore** | `/explore` | The graph in space: points on a sphere by id, edges as followable threads. Position carries no meaning, on purpose *(dev)* | no spring layout implying proximity is significance |
| **Agent activity** | `/agents` | Every background run, including ones that did nothing; colour carries status *(dev)* | never the content of entries — counts only |
| **Settings** | `/settings` | Four switches and a way out | reassurance text repeated on every screen |
| **Developer** | `/dev` | The three inspection surfaces above | not a security boundary; just out of the way |

## 6. Copy rules

- Say the count, not the conclusion. "4 entries across 3 days", not "you often…".
- Name the method's limits inline: `(UTC)` appears on a calendar claim only while
  some of its evidence predates timezone capture, and disappears when it does not.
- Never *should*, *but*, *despite*, *even though*, *fail*, *streak*, *reminder*,
  *score*. The e2e suite greps for several of these and fails the build.
- An empty state states the fact and stops: "Nothing has come back often enough
  to call a pattern yet."
- Crisis wording is locally configured and deliberately not defaulted; a
  wrong-country hotline is worse than none.

## 7. Where the design is currently weakest

Honest list, for anyone deciding what to work on:

1. **Themes are labelled by listing their members** ("dread, the office, my
   manager"). Epistemically clean, phenomenologically inert. A real summary needs
   a model and a safety decision.
2. **Findings are strong claims in weak clothing.** The most insight-dense
   objects — a lag ordering, a stated-vs-recorded gap — are rendered with the
   same generic point-and-readout as a single recurrence.
3. **The four core screens carry no menu**; leaving them means using the back
   control. See `docs/NAVIGATION.md` §6.
4. **Nothing is designed for the first week.** Detectors need weeks of material
   before they say anything, and the app currently has no honest way to be
   interesting while it waits.

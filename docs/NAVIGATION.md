# Navigation: menus, tabs, and how screens are reached

Written for another model picking this codebase up. It describes what the code
does today (2026-08-04), not what it should do. Where the code contradicts
itself, that is called out rather than smoothed over — those are the places you
will otherwise waste time being confused.

## The one-sentence version

There is **no tab navigator**. Every screen is a route in a single flat
`expo-router` `Stack`, and the tab-like things you see are three *different*
in-app menu surfaces plus one in-screen lens switcher, none of which know about
each other.

---

## 1. Router model

`/words` is the public, data-free disclosure route. It is intentionally the only
public app route besides `/login`: signed-out visitors can read it and return to
login, while its writing and Settings actions remain authenticated. The bottom
TabBar is hidden on both public routes.

`apps/mobile/app/_layout.tsx` is the only layout file. It renders one `<Stack>`
with a screen list. File-based routing means **a file under `app/` is a route
whether or not it is registered** in that list; registration only sets the
header title.

```
RootLayout
  QueryClientProvider   ← client is rebuilt per userId; a 401 clears the session
    SafeAreaProvider
      Gate              ← auth redirect, then <Stack>
```

`useAuthGate()` (same file) does two things and is the reason screens can assume
a token exists:

- signed out + not on `/login` or `/words` → `router.replace("/login")`
- signed in + on `/login` → `router.replace("/")`
- it waits for `ready` (the keychain read) before either, so a returning user is
  not bounced out during the async restore.

Screens still do `if (!token) return null;` as a second line of defence, because
the redirect is an effect and runs one render late.

## 2. The route table

| Route | File | Registered title | Reached from |
|---|---|---|---|
| `/` | `index.tsx` | Journal | auth gate; SpatialDock |
| `/login` | `login.tsx` | *(header hidden)* | auth gate |
| `/today` | `today.tsx` | Today | both menus |
| `/week` | `week.tsx` | This week | both menus |
| `/headspace` | `headspace.tsx` | Headspace | both menus |
| `/identity` | `identity.tsx` | Identity | both menus |
| `/settings` | `settings.tsx` | Settings | NavOrbit (quiet) |
| `/dev` | `dev.tsx` | Developer | NavOrbit (dev on); Settings |
| `/talk` | `talk.tsx` | Talk it through | Journal |
| `/graph` | `graph.tsx` | Graph | Dev menu |
| `/explore` | `explore.tsx` | Explore | Graph only |
| `/patterns` | `patterns.tsx` | Patterns | Headspace "Recurring" lens |
| `/pattern/[id]` | `pattern/[id].tsx` | What came first | Patterns (lag detector only) |
| `/experiments` | `experiments.tsx` | Experiments | Patterns; Dev menu |
| `/experiment/[id]` | `experiment/[id].tsx` | Experiment | Experiments |
| `/agents` | `agents.tsx` | Agent activity | Dev menu only |
| `/node/[id]` | `node/[id].tsx` | Where this came from | almost every screen |

`/node/[id]` is the hub: Today, Week, Journal, Headspace, Identity, Explore,
Graph, Experiment detail and the ordering screen all push into it. It is the
explain screen, and reaching it from everywhere is deliberate — every inference
in this product has to be traceable to the words that produced it.

## 3. The three menu surfaces

### 3a. `NavOrbit` — the primary menu

`src/components/NavOrbit.tsx`. **Rendered on exactly one screen: `/` (Journal).**
A row of coloured dots with word labels (the labels are load-bearing: unlabelled
dots are a puzzle and invisible to a screen reader).

Destinations come from `orbitDestinations(developer)` in
`src/lib/destinations.ts`: **Headspace · Today · Week · Identity**, then
**Settings** marked `quiet`, then **Dev** only when the developer preference is
on (`usePreferences(s => s.developer)`).

Its docstring records the intent: it went from eight destinations to four. The
run log and experiment engine moved behind the developer switch, sign-out moved
into Settings, and graph/patterns were folded into Headspace as *lenses* —
"they were never separate places so much as separate ways of looking at the same
material."

### 3b. `SpatialDock` — the secondary menu

`src/components/SpatialField.tsx`, rendered by `AtmosphericShell`
(`src/components/Atmospheric.tsx`) for every variant except `login`. So it
appears on: `/graph`, `/talk`, `/experiments`, `/experiment/[id]`,
`/node/[id]`, `/pattern/[id]`.

Its routes come from `dockDestinations()` — the same four as the orbit, led by
**Journal**, because the dock rides on screens you reached by following
something and the likeliest next move is going back to where you write. Quiet
corners are deliberately excluded: Settings on a detail screen is an invitation
to wander off mid-thought.

### 3c. The Dev menu

`app/dev.tsx`. A list of three inspection surfaces: Run log (`/agents`), Graph
readout (`/graph`), Experiments (`/experiments`). Gated twice — it redirects to
`/settings` when the developer preference is off, and waits for `ready` before
deciding, or it bounces on every cold start. Not a security boundary; the
docstring is explicit that it is hidden to keep machinery out of the way of
someone opening a journal, not to lock anything.

## 4. The thing that looks most like tabs: Headspace lenses

Under the **Recurring** lens the screen also offers "Open patterns", which is
the only route into `/patterns`. It appears only under that lens and only when
there is something to open.

`app/headspace.tsx` holds a `Lens` state — `today | all | patterns | changed`,
labelled **Today · Everything · Recurring · Changed**. Selecting one
re-queries and repopulates the same visualisation; it does **not** navigate.
Selection is cleared on switch, because a readout for a point that no longer
exists in the new lens would be stale.

The ordering is an argument, per the docstring: a day is a fact, the whole graph
is a record, a pattern is a claim — each step is further from what the person
actually wrote, and the row makes that distance visible.

`changed` is special-cased: its readout has no "open" action, because a temporal
change is a comparison between windows rather than a node you can explain.

## 5. Shared screen chrome

Two composition patterns; most screens use one or the other.

- **`Observatory`** (`src/components/Observatory.tsx`) — used by Headspace,
  Identity, Patterns, Agents, Explore. Props: `eyebrow`, `data` (points with
  `weight`/`tone`/`tentative`), `selected`/`onSelect`, `detail`, `hint`,
  `empty`, `loading`, `error`, `action`, `secondaryAction`, `dotSize`, `frame`.
  Its `Readout` sub-component renders the selected item as tone · meta ·
  optional "open" link, capped at three facts on purpose — a fourth "belongs on
  the screen you tap through to".
- **`AtmosphericShell`** — used by Login, Journal-adjacent and detail screens
  (list in 3b). Supplies the animated backdrop *and* the SpatialDock.

## 6. Inconsistencies that were fixed, and the one that remains

Fixed on 2026-08-04, after this note first recorded them:

1. **The two menus disagreed.** NavOrbit had been cut from eight destinations to
   four; SpatialDock still offered the three that were deliberately demoted. Both
   now compose one list in `src/lib/destinations.ts`, and
   `src/lib/destinations.test.ts` fails if they ever diverge again.
2. **`/patterns` had no route in from the primary menu.** Headspace's "Recurring"
   lens now offers "Open patterns" — only under that lens, and only when there is
   something to open.
3. **`/headspace`, `/settings` and `/dev` were unregistered**, so their headers
   showed raw route names. All three are registered with written titles.

Still true, and deliberate for now:

4. **`/explore` is reachable only from `/graph`**, which is itself behind the
   developer switch. It is a second view of material the Headspace "Everything"
   lens already shows, so promoting it would mean deciding which of the two is
   the real one — a product decision, not a cleanup.
5. **Nothing renders NavOrbit except `/`.** Today, Week, Headspace, Identity and
   Settings have no menu of their own; you leave them with the Stack's back
   control. The dock covers the detail screens. Whether the four core screens
   should also carry a menu is open.

## 7. Conventions if you add a screen

- Create `app/<name>.tsx`; it is routable immediately.
- Register it in `_layout.tsx` **with a written title** — the default is the
  filename, which reads as a bug.
- Decide which menu should reach it. The two general menus share one list:
  edit `src/lib/destinations.ts` and both update together — do not add a route
  to `NavOrbit.tsx` or `SpatialDock` directly. Machinery goes in `dev.tsx`
  instead. `src/lib/destinations.test.ts` enforces that the menus agree and that
  machinery stays out of them, so it will tell you if you picked wrong.
- Gate on `token` and return `null` when absent; the redirect is one render late.
- If it is a detail view of an inference, push to `/node/[id]` rather than
  re-explaining provenance locally.
- Screens are not unit-tested by construction: `jest` `testMatch` is
  `**/src/**/*.test.ts`, so nothing under `app/` and no `.tsx` is collected.
  Pure logic belongs in `src/lib/*.ts` where it can be tested — see
  `src/lib/patterns.ts` (`patternMeta`, `patternDestination`), which exists so
  that "which screen does a pattern open" is a tested decision rather than an
  inline conditional.

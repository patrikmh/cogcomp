# Deploying Tlön

`render.yaml` at the repo root describes the whole thing: Postgres, the API, the
static web client, and FalkorDB. Apply it as a Render Blueprint, then set the
secrets it deliberately leaves blank.

Everything below is either a value you must supply or a trap worth knowing about
before it costs you an afternoon.

## Secrets to set by hand

| Variable | Service | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | `tlon-api` | Without it the API refuses to boot. See below. |
| `OPENROUTER_MODEL` | `tlon-api` | Defaults to `anthropic/claude-opus-5`. |
| `TRANSCRIPTION_API_KEY` | `tlon-api` | ElevenLabs. Real keys begin `sk_`. |
| `SPEECH_VOICE_ID` | `tlon-api` | No default on purpose — nobody should be assigned a voice silently. |
| `CRISIS_RESOURCES` | `tlon-api` | Pipe-separated. Set it. |
| `WEB_ORIGIN` | `tlon-api` | **Comma-separated**, both client origins, `https://…`. |
| `VITE_API_URL` | `tlon-web` | Full URL, `https://…`. Build-time. |
| `VITE_MOBILE_URL` | `tlon-web` | The `tlon-mobile` URL. Build-time. Unset means nobody is redirected. |
| `EXPO_PUBLIC_API_URL` | `tlon-mobile` | Same API URL. Build-time. |
| `REDIS_ARGS` | `tlon-falkor` | `--requirepass <password>` |
| `FALKOR_PASSWORD` | `tlon-api` | The same password, on its own. |

The FalkorDB password is set twice because it has to exist in two shapes — inside
a redis-server argument string on one service and as a bare value on the other —
and a blueprint cannot interpolate one into the other.

## Four things that will bite

**The API refuses to start without a model key, and that is the feature.**
`REQUIRE_REAL_MODEL=true` is set in the blueprint. Without `OPENROUTER_API_KEY`
the app would otherwise fall back to `StubExtractor` and serve invented readings
— every screen working, every count adding up, and nothing true in any of it.
A boot failure is the only version of that anybody notices.

**`WEB_ORIGIN` and `VITE_API_URL` need the scheme.** They are a CORS origin and a
`fetch` base. `https://tlon-web.onrender.com`, not `tlon-web.onrender.com`.
Render can supply a hostname but cannot prepend a scheme, so both are set by
hand rather than wired to a value of the wrong shape. `VITE_API_URL` is baked
into the bundle at build time: changing it means a rebuild, not a restart.

**The API install must stay editable.** `buildCommand` is `pip install -e .`.
`MIGRATIONS_DIR` is derived from `__file__` in `tlon/db/engine.py`, so a normal
install puts the package under `site-packages`, resolves the migrations
directory somewhere else entirely, and fails all twelve migrations on first boot.

**One API instance.** The agent scheduler runs inside the web process
(`main.py`), so a second instance is a second scheduler rewriting one person's
graph underneath the first.

## Two clients, and how a phone gets the right one

`tlon-web` is the desktop client and has **no mobile layout** — the design it was
ported from has no width breakpoints anywhere, only `prefers-reduced-motion`. On
a phone its navigation rail takes 17% of the width permanently and its labels
never appear, because they unfurl on hover and a touch screen has none. Twelve
unlabelled icons is not a navigation.

So phones are sent to `tlon-mobile`, the Expo client exported to static web.

**The redirect is client-side**, in `apps/web/index.html`, because it has to be:
Render serves these as static files and has no server to inspect a user agent
with. The test is `(pointer: coarse)` **and** a viewport under 700px — not a list
of device names, which is a thing you maintain forever and still get wrong. A
narrow desktop window keeps the desktop client; a tablet keeps it too.

`?desktop=1` opts out permanently, stored in `localStorage`. It is a link you can
give someone, not a setting they have to find.

Two consequences worth knowing:

- **`WEB_ORIGIN` takes both origins, comma-separated.** Two clients on two
  origins both call one API.
- **`tlon-mobile` needs the SPA rewrite and `tlon-web` does not.** expo-router
  uses real paths and the export emits one `index.html`, so without the rewrite
  every route but the root 404s on refresh. The desktop client is hash-routed and
  never asks the server for a route at all.

**Weight.** The Expo export is ~9 MB, of which 7.3 MB is the Skia `canvaskit.wasm`
that the blob and constellation draw with. That is a real first load over mobile
data, and it is the thing to look at first if the phone client feels slow.

## FalkorDB

There is no managed FalkorDB on Render — Render Key Value is Valkey and has no
graph module — so it runs as a private service from the upstream image, reachable
only from inside the blueprint, password-protected because the private network is
shared with everything else in the account.

Two details about the image, both found by opening it rather than by reasoning
about it:

- **It starts a Node browser UI on port 3000 unless `BROWSER=0`.** Nothing here
  uses it, and on a platform that finds a service by looking for an open port, a
  second listener is a coin toss. The blueprint sets it to `0`; with that, the
  only thing listening is 6379.
- **Do not override the command.** The entrypoint (`run.sh`) assembles the
  `redis-server` invocation itself — data directory, module path, TLS — and
  reads `REDIS_ARGS` for anything extra. Replacing the command steps over all of
  that to re-derive it by hand from paths that belong to the image.

Verified locally against `falkordb/falkordb:latest`: with `BROWSER=0` and
`REDIS_ARGS=--requirepass …`, an unauthenticated `PING` gets
`NOAUTH Authentication required` and the app's own `graphiti_client.build()`
connects and builds indices through the settings path.

**It has no disk, deliberately.** `themes_agent` rebuilds the entire projection
from Postgres on every run, and runs daily. Postgres is authoritative for
everything in it. A restart loses nothing that is not recomputed within a day,
and a disk would buy durability the design does not want while pinning the
service to one instance to do it.

The consequence to expect: if FalkorDB is unreachable, the themes agent fails and
records the failure. It shows up as failed runs on the Agents screen at that
agent's cadence rather than as a broken app — everything else keeps working,
because nothing else touches Graphiti.

Running it without FalkorDB at all is a supported position: set
`AGENTS_ENABLED=false` and no background work runs, including themes. Patterns
and readings are unaffected.

## Verifying a deployment

In this order, because each step depends on the one before:

1. **The API boots**, and its first-start logs say twelve migrations applied.
2. **Sign up** through the deployed client.
3. **Write an entry, then open the reading it produced** (`/node/:id`) and check
   the extractor stamp names the real model. This is the check that catches a
   stub deployment — the only one that does, since nothing else looks wrong.
4. **`POST /v1/agents/run`**, then look at the Agents screen: the themes agent
   should complete rather than fail to connect. That is FalkorDB proving itself.
5. **Restart `tlon-falkor` and run the agents again.** Themes should rebuild from
   an empty store. The no-disk decision rests on exactly this, so it is worth
   seeing once rather than believing.

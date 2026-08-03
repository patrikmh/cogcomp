#!/usr/bin/env python3
"""Replay a life day by day and watch what the system concludes.

The extraction benchmark asks whether one entry is read responsibly. This asks a
question no single-entry test can: whether the conclusions drawn *across* entries
behave decently as the record grows. That matters because the failures here are
invisible in a snapshot and obvious over months —

- a pattern that flickers in and out with every run
- a conclusion that takes six weeks to notice something that started in week one
- a pattern that changes id, so its age resets and rejecting it does nothing
- a finding announced as new every time it is re-derived

None of those are wrong at any single moment. All of them are corrosive to
someone reading the thing weekly, which is the only way this product is used.

Waiting months to find out is not an option, so the history is synthetic and its
answers are known — see `benchmarks/history.py` for what is planted and why.

    # Needs the dev Postgres up (infrastructure/docker-compose.yml).
    python -m benchmarks.replay
    python -m benchmarks.replay --days 60 --json replay.json

Exits non-zero if a planted thread is missed, a forbidden one is reported, or a
pattern's identity churns.
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "backend"))

import asyncpg
from tlon.db import cooccurrence as cooccurrence_db
from tlon.db import patterns as patterns_db
from tlon.db.engine import run_migrations
from tlon.lag import mine as mine_lags
from tlon.patterns import RECENCY_DAYS

from benchmarks.history import (
    EXPECTED,
    EXPECTED_LAGS,
    EXPECTED_PAIRS,
    EXPECTED_PERIODICITY,
    FORBIDDEN,
    FORBIDDEN_LAGS,
    FORBIDDEN_PAIRS,
    HORIZON_DAYS,
    entries_on,
)

DEV_URL = "postgres://tlon:tlon@localhost:5433/tlon"
REPLAY_DB = "tlon_replay"
DAY_ZERO = datetime(2026, 1, 5, 9, 0, tzinfo=UTC)  # a Monday
PatternIdentity = tuple[str, str]


@dataclass
class Track:
    """What happened to one pattern key over the whole replay."""

    first_reported_day: int | None = None
    #: Every node id this key has ever been stored under. More than one means the
    #: claim lost its identity mid-run, which is the bug this harness exists for.
    node_ids: set[str] = field(default_factory=set)
    #: Days it was live. Gaps are lapses.
    live_days: list[int] = field(default_factory=list)

    @property
    def churned(self) -> bool:
        return len(self.node_ids) > 1

    @property
    def returns(self) -> int:
        """How many times it came back after being absent."""
        return sum(
            1
            for earlier, later in itertools.pairwise(self.live_days)
            if later - earlier > 1
        )


def eligible_day(days: tuple[int, ...]) -> int | None:
    """The first day a thread has enough behind it to be reportable.

    Mirrors the thresholds in `tlon.patterns` rather than importing them, because
    a benchmark that derives its expectations from the code under test cannot
    catch that code lowering its own bar.
    """
    seen: list[int] = []
    for day in days:
        seen.append(day)
        if len(seen) >= 3 and len(set(seen)) >= 2:
            return day
    return None


async def _fresh_database() -> str:
    base, _, _ = DEV_URL.rpartition("/")
    admin = await asyncpg.connect(
        f"{base}/postgres".replace("postgres://", "postgresql://", 1)
    )
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{REPLAY_DB}" WITH (FORCE)')
        await admin.execute(f'CREATE DATABASE "{REPLAY_DB}"')
    finally:
        await admin.close()
    return f"{base}/{REPLAY_DB}".replace("postgres://", "postgresql://", 1)


async def _write_entry(
    pool: asyncpg.Pool, user_id: UUID, day: int, label: str, captured_at: datetime
) -> UUID:
    observation_id = uuid4()
    content = f"day {day}: {label}"
    await pool.execute(
        "INSERT INTO graph_nodes (id, user_id, kind, label) VALUES ($1, $2, 'Observation', $3)",
        observation_id,
        user_id,
        content,
    )
    await pool.execute(
        """
        INSERT INTO observations (node_id, user_id, content, source, captured_at)
        VALUES ($1, $2, $3, 'text', $4)
        """,
        observation_id,
        user_id,
        content,
        captured_at,
    )
    return observation_id


async def _write_day(pool: asyncpg.Pool, user_id: UUID, day: int) -> None:
    """Everything the synthetic person wrote on one day.

    One entry per thread, except where a thread declares that it shares another's
    entry and that other thread was also written about today. Threads in separate
    entries never co-occur, so associations only exist where the corpus says two
    things were written in the same breath.
    """
    today = entries_on(day)
    written_today = {thread.label for thread in today}
    captured_at = DAY_ZERO + timedelta(days=day)
    entry_of: dict[str, UUID] = {}

    # Hosts first, so a sharer always finds its host's entry already made.
    hosts = [
        thread for thread in today if thread.shares_entry_with not in written_today
    ]
    sharers = [thread for thread in today if thread.shares_entry_with in written_today]

    for thread in hosts + sharers:
        host = thread.shares_entry_with
        observation_id = entry_of.get(host) if host in written_today else None
        if observation_id is None:
            observation_id = await _write_entry(
                pool, user_id, day, thread.label, captured_at
            )
        entry_of[thread.label] = observation_id

        node_id = uuid4()
        await pool.execute(
            """
            INSERT INTO graph_nodes
                (id, user_id, kind, label, confidence, epistemic_status, extractor)
            VALUES ($1, $2, $3, $4, $5, 'hypothesis', 'replay')
            """,
            node_id,
            user_id,
            thread.kind,
            thread.label,
            thread.confidence,
        )
        await pool.execute(
            "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
            node_id,
            observation_id,
        )


async def _live_patterns(
    pool: asyncpg.Pool, user_id: UUID
) -> dict[PatternIdentity, str]:
    """Detector and pattern key to node id, for every live claim."""
    rows = await pool.fetch(
        """
        SELECT p.detector, p.pattern_key, p.node_id
        FROM patterns p
        JOIN graph_nodes n ON n.id = p.node_id
        WHERE p.user_id = $1 AND p.lapsed_at IS NULL AND n.deleted_at IS NULL
        """,
        user_id,
    )
    return {(row["detector"], row["pattern_key"]): str(row["node_id"]) for row in rows}


async def replay(days: int) -> dict:
    url = await _fresh_database()
    pool = await asyncpg.create_pool(url)
    assert pool is not None
    try:
        await run_migrations(pool)
        user_id = uuid4()
        await pool.execute(
            "INSERT INTO users (id, email) VALUES ($1, $2)",
            user_id,
            f"replay-{user_id}@example.test",
        )

        tracks: dict[PatternIdentity, Track] = defaultdict(Track)
        pair_tracks: dict[frozenset[str], Track] = defaultdict(Track)
        lag_tracks: dict[str, Track] = defaultdict(Track)
        churn_events = 0

        for day in range(days):
            await _write_day(pool, user_id, day)
            # Mining every day rather than every entry: the question is what a
            # person sees when they open the app, and that is a daily rhythm.
            await patterns_db.remine(pool, user_id)
            await cooccurrence_db.remine(pool, user_id)
            candidates = await patterns_db.load_candidates(pool, user_id)
            observed_days = await patterns_db.load_observed_days(pool, user_id)
            for finding in mine_lags(candidates, observed_days):
                track = lag_tracks[finding.key]
                if track.first_reported_day is None:
                    track.first_reported_day = day
                # Dark-launch findings do not have database identity yet. The
                # stable semantic key is what this tracer can verify.
                track.node_ids.add(f"dark-launch:{finding.key}")
                track.live_days.append(day)

            for identity, node_id in (await _live_patterns(pool, user_id)).items():
                track = tracks[identity]
                if track.first_reported_day is None:
                    track.first_reported_day = day
                if track.node_ids and node_id not in track.node_ids:
                    churn_events += 1
                track.node_ids.add(node_id)
                track.live_days.append(day)

            for pair in await cooccurrence_db.list_for_user(pool, user_id):
                track = pair_tracks[frozenset((pair["a_label"], pair["b_label"]))]
                if track.first_reported_day is None:
                    track.first_reported_day = day
                track.node_ids.add(pair["id"])
                track.live_days.append(day)

        return _report(tracks, pair_tracks, lag_tracks, churn_events, days)
    finally:
        await pool.close()


def _report(
    tracks: dict[PatternIdentity, Track],
    pair_tracks: dict[frozenset[str], Track],
    lag_tracks: dict[str, Track],
    churn_events: int,
    days: int,
) -> dict:
    found = {}
    missed = {}
    for key, thread in EXPECTED.items():
        eligible = eligible_day(tuple(d for d in thread.days if d < days))
        track = tracks.get(("exact-label", key))
        if track is None or track.first_reported_day is None:
            missed[key] = {"probes": thread.probes, "eligible_on": eligible}
            continue
        written = [day for day in thread.days if day < days]
        longest_silence = max(
            (later - earlier - 1 for earlier, later in itertools.pairwise(written)),
            default=0,
        )
        found[key] = {
            "detected_on": track.first_reported_day,
            "eligible_on": eligible,
            # How many days the person waited after there was something to say.
            "lag_days": None
            if eligible is None
            else track.first_reported_day - eligible,
            "returns": track.returns,
            "identities": len(track.node_ids),
            # The longest the thread went unwritten. Paired with `returns`, this is
            # the dormancy measurement: a thread silent for weeks that never
            # returned is one the system never stopped claiming, because mining
            # counts all of history and the old evidence never expires.
            "longest_silence_days": longest_silence,
            "claimed_throughout_silence": track.returns == 0 and longest_silence > 0,
        }

    reported_forbidden = {
        key: tracks[("exact-label", key)].first_reported_day
        for key in FORBIDDEN
        if ("exact-label", key) in tracks
    }
    churned = sorted(
        f"{detector}:{key}"
        for (detector, key), track in tracks.items()
        if track.churned
    )

    return {
        "days": days,
        "found": found,
        "missed": missed,
        "false_positives": reported_forbidden,
        "identity_churn_events": churn_events,
        "churned_patterns": churned,
        "periodicity": _periodicity_report(tracks, days),
        "associations": _pair_report(pair_tracks),
        "lags": _lag_report(lag_tracks, days),
    }


def _periodicity_report(
    tracks: dict[PatternIdentity, Track],
    days: int,
) -> dict:
    """Calendar claims, kept separate from generic recurrence truth."""
    reported = {
        key: track.first_reported_day
        for (detector, key), track in tracks.items()
        if detector == "weekday-utc" and track.first_reported_day is not None
    }
    expected = {
        key: thread
        for key, thread in EXPECTED_PERIODICITY.items()
        if len([day for day in thread.days if day < days]) >= 4
    }
    return {
        "found": {key: reported[key] for key in expected if key in reported},
        "missed": {
            key: {
                "eligible_on": [day for day in thread.days if day < days][3],
                "probes": thread.probes,
            }
            for key, thread in expected.items()
            if key not in reported
        },
        # Every calendar claim needs planted truth. There is no harmless
        # "interesting extra" when the system is describing a person's rhythm.
        "unaccounted": {
            key: day for key, day in reported.items() if key not in expected
        },
    }


def _pair_report(pair_tracks: dict[frozenset[str], Track]) -> dict:
    """What the association detector claimed, against what was planted.

    Every reported pair not in `EXPECTED_PAIRS` is listed, not only the ones
    explicitly planted as decoys. An association is the kind of finding a person
    cannot check against their own memory, so anything unaccounted-for here is a
    thing the system would be telling someone about their life for no reason.
    """
    reported = {pair: track.first_reported_day for pair, track in pair_tracks.items()}
    return {
        "found": {
            " + ".join(sorted(pair)): reported[pair]
            for pair in EXPECTED_PAIRS
            if pair in reported
        },
        "missed": [
            " + ".join(sorted(pair)) for pair in EXPECTED_PAIRS if pair not in reported
        ],
        "planted_decoys_reported": [
            " + ".join(sorted(pair)) for pair in FORBIDDEN_PAIRS if pair in reported
        ],
        "unaccounted": {
            " + ".join(sorted(pair)): day
            for pair, day in reported.items()
            if pair not in EXPECTED_PAIRS
        },
    }


def _lag_report(lag_tracks: dict[str, Track], days: int) -> dict:
    """Ordered timing claims, separate from recurrence and co-occurrence."""
    reported = {
        key: track.first_reported_day
        for key, track in lag_tracks.items()
        if track.first_reported_day is not None
    }
    # The fourth planted match completes on day 30. Keep the benchmark threshold
    # independent of detector constants so lowering the implementation's bar
    # cannot make its own benchmark pass.
    expected = EXPECTED_LAGS if days >= 31 else {}
    return {
        "found": {key: reported[key] for key in expected if key in reported},
        "missed": {
            key: {"eligible_on": 30, "probes": probes}
            for key, probes in expected.items()
            if key not in reported
        },
        "planted_decoys_reported": {
            key: reported[key] for key in FORBIDDEN_LAGS if key in reported
        },
        "unaccounted": {
            key: day for key, day in reported.items() if key not in expected
        },
    }


def _print(report: dict) -> None:
    print(f"\nreplayed {report['days']} days\n")

    print("found:")
    for key, detail in sorted(report["found"].items()):
        lag = detail["lag_days"]
        lag_text = "same day" if lag == 0 else f"{lag}d late" if lag else "n/a"
        returns = f", returned {detail['returns']}x" if detail["returns"] else ""
        print(f"  {key:<28} day {detail['detected_on']:>3}  ({lag_text}{returns})")

    if report["missed"]:
        print("\nmissed:")
        for key, detail in sorted(report["missed"].items()):
            print(f"  {key:<28} eligible day {detail['eligible_on']}")
            print(f"  {'':<28} {detail['probes']}")

    if report["false_positives"]:
        print("\nreported but should not have been:")
        for key, day in sorted(report["false_positives"].items()):
            print(f"  {key:<28} day {day}")

    periodicity = report["periodicity"]
    print("\nweekday patterns found:")
    for key, day in sorted(periodicity["found"].items()):
        print(f"  {key:<36} day {day}")
    for key, detail in sorted(periodicity["missed"].items()):
        print(f"  {key:<36} MISSED (eligible day {detail['eligible_on']})")
    if periodicity["unaccounted"]:
        print("\nweekday patterns reported that were not planted:")
        for key, day in sorted(periodicity["unaccounted"].items()):
            print(f"  {key:<36} day {day}")

    # Only silences longer than the dormancy window. A pattern surviving a quiet
    # fortnight is the window doing its job; one surviving two months is the
    # system claiming something about a person that stopped being true.
    stale = {
        key: detail["longest_silence_days"]
        for key, detail in report["found"].items()
        if detail["claimed_throughout_silence"]
        and detail["longest_silence_days"] > RECENCY_DAYS
    }
    if stale:
        print("\nstill claimed after the dormancy window had passed:")
        for key, silence in sorted(stale.items(), key=lambda item: -item[1]):
            print(f"  {key:<28} silent {silence} days, never withdrawn")

    pairs = report["associations"]
    print("\nassociations found:")
    for label, day in sorted(pairs["found"].items()):
        print(f"  {label:<28} day {day}")
    for label in sorted(pairs["missed"]):
        print(f"  {label:<28} MISSED")
    if pairs["unaccounted"]:
        print("\nassociations reported that were not planted:")
        for label, day in sorted(pairs["unaccounted"].items()):
            decoy = (
                " (planted decoy)" if label in pairs["planted_decoys_reported"] else ""
            )
            print(f"  {label:<28} day {day}{decoy}")

    lags = report["lags"]
    print("\nordered timing found (dark launch):")
    for key, day in sorted(lags["found"].items()):
        print(f"  {key:<56} day {day}")
    for key, detail in sorted(lags["missed"].items()):
        print(f"  {key:<56} MISSED (eligible day {detail['eligible_on']})")
    if lags["unaccounted"]:
        print("\nordered timing reported that was not planted:")
        for key, day in sorted(lags["unaccounted"].items()):
            decoy = " (planted decoy)" if key in lags["planted_decoys_reported"] else ""
            print(f"  {key:<56} day {day}{decoy}")

    print(f"\nidentity churn events: {report['identity_churn_events']}")
    if report["churned_patterns"]:
        for key in report["churned_patterns"]:
            print(f"  {key} was stored under more than one id")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=HORIZON_DAYS)
    parser.add_argument("--json", type=Path, help="write the full report here")
    args = parser.parse_args()

    report = asyncio.run(replay(args.days))
    _print(report)
    if args.json:
        args.json.write_text(json.dumps(report, indent=2))

    pairs = report["associations"]
    periodicity = report["periodicity"]
    lags = report["lags"]
    failed = (
        bool(report["false_positives"])
        or report["identity_churn_events"] > 0
        or bool(periodicity["missed"])
        or bool(periodicity["unaccounted"])
        # An association nobody planted is a claim about someone's life invented
        # by arithmetic, and it is the failure the person is least able to catch.
        or bool(pairs["unaccounted"])
        or bool(pairs["missed"])
        or bool(lags["unaccounted"])
        or bool(lags["missed"])
    )
    print("\nFAIL" if failed else "\nOK")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

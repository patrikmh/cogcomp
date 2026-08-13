"""Every animation the design specifies, against the numbers mobile animates with.

The web renders the design's keyframes directly: `tlon.css` is the stylesheet
copied over, so `typography.py` and `stylesheet.py` between them keep it honest.
The mobile client cannot do that. React Native has no stylesheet and no
keyframes, so every duration, easing and delay is a constant in a component —
`DRAW_MS = 900`, `Easing.bezier(0.3, 0.8, 0.2, 1)` — and nothing has ever
compared those constants to the design they were copied from.

They were copied by hand, one screen at a time, over many sittings. That is
exactly the kind of transcription that drifts: a .45s read as .5s, a stagger of
26ms typed as 30. Both would look right and neither would be.

    python3 scripts/parity/motion.py '<design>/tlon-mobile.html'

Exits non-zero if a duration or easing the design states is not present in the
mobile client's constants. A constant the client has and the design does not is
reported but allowed — the port has states the prototype never had, and some of
them legitimately need motion the design never named.

Each of the design's animations is also tied to the component that implements
it, so a curve swapped between two components fails rather than passing because
both values are still present somewhere. That mapping is the one thing here a
person has to maintain: a new screen animating in a new way needs a line in
`IMPLEMENTED_BY`, and a design animation this client has no equivalent for
belongs there as `None` with a reason.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
MOBILE = ROOT / "apps/mobile/src/components"
MOBILE_APP = ROOT / "apps/mobile/app"

# Which file must carry each animation's numbers. The design names a motion;
# this says where it lives, so a curve moved from one component to another is
# a failure rather than a value that happens to still exist somewhere.
IMPLEMENTED_BY: dict[str, list[str]] = {
    # An act rising into the journal, and the same arrival on record screens.
    "jEnter": ["Rise.tsx"],
    "sUp": ["Rise.tsx"],
    # An act's seal drawing itself on, in both the journal's and the record
    # screens' vocabulary.
    "jSealDraw": ["Seal.tsx"],
    "sSeal": ["Seal.tsx"],
    # A finding's seal, stamped rather than stroked.
    "pSeal": ["Seal.tsx"],
    # Bars growing out of a baseline: a fortnight under a finding, and a week.
    # A fortnight under a finding, a week's columns, and an experiment's arc.
    "pBar": ["Strip.tsx", "WeekChart.tsx", "Arc.tsx"],
    # A confidence meter filling from zero.
    "sMeter": ["Marks.tsx"],
    # The wash behind a search match.
    "sMark": ["search.tsx"],
}


def design_animations(html: str) -> dict[str, set[tuple[int, str]]]:
    """Every `animation: <name> <duration> <easing>` the design declares.

    A keyframe can be declared at more than one duration and both are the
    design's: `pBar` grows a finding's fortnight over .5s and a week's column
    over .45s, and `sSeal` draws at .8s in one place and .9s in another. So
    every pair is kept, and a component satisfies the check by using any of
    them — reducing this to one number per name is what made the week's columns
    read as wrong when they were right.
    """
    found: dict[str, set[tuple[int, str]]] = {}
    for match in re.finditer(
        r"animation:\s*([\w-]+)\s+([\d.]+)s\s+(cubic-bezier\([^)]*\)|linear|ease[\w-]*)",
        html,
    ):
        name = match.group(1)
        pair = (round(float(match.group(2)) * 1000), match.group(3).replace(" ", ""))
        found.setdefault(name, set()).add(pair)
    return found


def mobile_files() -> dict[str, str]:
    """Every mobile source file that could carry a motion constant, by name."""
    out: dict[str, str] = {}
    for path in sorted(MOBILE.rglob("*.tsx")) + sorted(MOBILE_APP.rglob("*.tsx")):
        out[path.name] = path.read_text()
    return out


def mobile_source(files: dict[str, str]) -> str:
    return "\n".join(files.values())


def milliseconds(source: str) -> set[int]:
    """Every duration the mobile client animates with."""
    out = set()
    for match in re.finditer(r"(?:duration|delay):\s*(\d+)", source):
        out.add(int(match.group(1)))
    for match in re.finditer(r"_MS\s*=\s*(\d+)", source):
        out.add(int(match.group(1)))
    return out


def easings(source: str) -> set[str]:
    """Every bezier the mobile client eases with, as the design writes them."""
    out = set()
    for match in re.finditer(r"Easing\.bezier\(([^)]*)\)", source):
        numbers = [n.strip().lstrip("0") or "0" for n in match.group(1).split(",")]
        out.add("cubic-bezier(" + ",".join(numbers) + ")")
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    html = pathlib.Path(sys.argv[1]).read_text()
    design = design_animations(html)
    files = mobile_files()
    source = mobile_source(files)
    have_ms = milliseconds(source)
    have_easing = easings(source)

    print(f"design animations: {len(design)}   mobile durations: {len(have_ms)}")

    missing_duration = []
    missing_easing = []
    for name, pairs in sorted(design.items()):
        if not any(ms in have_ms for ms, _ in pairs):
            missing_duration.append(f"{name}: {sorted(ms for ms, _ in pairs)}ms")
        curves = {e for _, e in pairs if e.startswith("cubic-bezier")}
        if curves and not (curves & have_easing):
            missing_easing.append(f"{name}: {sorted(curves)}")

    misplaced = []
    for name, pairs in sorted(design.items()):
        owners = IMPLEMENTED_BY.get(name)
        if not owners:
            misplaced.append(f"{name}: no component named for it in IMPLEMENTED_BY")
            continue
        wanted_ms = {ms for ms, _ in pairs}
        wanted_curves = {e for _, e in pairs if e.startswith("cubic-bezier")}
        for owner in owners:
            text = files.get(owner)
            if text is None:
                misplaced.append(f"{name}: {owner} does not exist")
                continue
            if not (milliseconds(text) & wanted_ms):
                misplaced.append(f"{name}: {owner} uses none of {sorted(wanted_ms)}ms")
            if wanted_curves and not (easings(text) & wanted_curves):
                misplaced.append(f"{name}: {owner} uses none of {sorted(wanted_curves)}")

    if missing_duration:
        print("\ndurations the design states and the client does not use:")
        for line in missing_duration:
            print("   ", line)
    if missing_easing:
        print("\neasings the design states and the client does not use:")
        for line in missing_easing:
            print("   ", line)

    if misplaced:
        print("\nanimations not implemented where they are named:")
        for line in misplaced:
            print("   ", line)

    if not missing_duration and not missing_easing and not misplaced:
        print("\nmotion matches")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

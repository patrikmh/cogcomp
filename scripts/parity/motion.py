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

What this cannot tell you: the check is over the *set* of values the client
uses, not over which component uses which. If a seal is given the strip's curve
and the strip keeps its own, both curves are still present and this passes. It
catches a value dropped or mistyped out of the codebase entirely, which is the
transcription error it was written for; it does not catch two components
swapping. Tested by hand: retyping `DRAW_MS = 900` as 950 fails with
"jSealDraw: 900ms", and changing that component's easing alone does not fail,
because `sMark` shares the curve.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
MOBILE = ROOT / "apps/mobile/src/components"
MOBILE_APP = ROOT / "apps/mobile/app"


def design_animations(html: str) -> dict[str, tuple[float, str]]:
    """Every `animation: <name> <duration> <easing>` the design declares."""
    found: dict[str, tuple[float, str]] = {}
    for match in re.finditer(
        r"animation:\s*([\w-]+)\s+([\d.]+)s\s+(cubic-bezier\([^)]*\)|linear|ease[\w-]*)",
        html,
    ):
        name, seconds, easing = match.group(1), float(match.group(2)), match.group(3)
        # A name can appear with two durations — the design draws a seal at .8s
        # in one place and .9s in another. Keep the longest, which is the one
        # the screens this client ports use.
        if name not in found or seconds > found[name][0]:
            found[name] = (seconds, easing.replace(" ", ""))
    return found


def mobile_source() -> str:
    parts = []
    for path in sorted(MOBILE.rglob("*.tsx")) + sorted(MOBILE_APP.rglob("*.tsx")):
        parts.append(path.read_text())
    return "\n".join(parts)


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
    source = mobile_source()
    have_ms = milliseconds(source)
    have_easing = easings(source)

    print(f"design animations: {len(design)}   mobile durations: {len(have_ms)}")

    missing_duration = []
    missing_easing = []
    for name, (seconds, easing) in sorted(design.items()):
        ms = round(seconds * 1000)
        if ms not in have_ms:
            missing_duration.append(f"{name}: {ms}ms")
        if easing.startswith("cubic-bezier") and easing not in have_easing:
            missing_easing.append(f"{name}: {easing}")

    if missing_duration:
        print("\ndurations the design states and the client does not use:")
        for line in missing_duration:
            print("   ", line)
    if missing_easing:
        print("\neasings the design states and the client does not use:")
        for line in missing_easing:
            print("   ", line)

    if not missing_duration and not missing_easing:
        print("\nmotion matches")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

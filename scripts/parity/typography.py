"""Every font declaration in the design, against every one in the app.

Typography drift is the kind that survives a screenshot comparison: a heading
half a weight light, a mono column at 11px where the design said 12, and nobody
notices until it is everywhere. This compares the two stylesheets directly, so
a missing weight is a failure rather than a squint.

    python3 scripts/parity/typography.py path/to/tlon.html

Reads the design's inline <style> and `apps/web/src/styles/tlon.css`, and exits
non-zero if either side declares something the other does not.
"""

import pathlib
import re
import sys

APP_CSS = pathlib.Path(__file__).resolve().parents[2] / "apps/web/src/styles/tlon.css"


def declarations(css: str) -> set[str]:
    """Every `font:` shorthand and every `font-weight:`, normalised."""
    found = set()
    for match in re.finditer(r"font:\s*([^;}]+)", css):
        found.add(re.sub(r"\s+", " ", match.group(1)).strip())
    for match in re.finditer(r"font-weight:\s*([^;}]+)", css):
        found.add("weight " + match.group(1).strip())
    return found


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    design = pathlib.Path(sys.argv[1]).read_text()
    style = re.search(r"<style>(.*?)</style>", design, re.S)
    if not style:
        print("no <style> block in the design file")
        return 2

    theirs = declarations(style.group(1))
    ours = declarations(APP_CSS.read_text())

    missing = sorted(theirs - ours)
    extra = sorted(ours - theirs)

    print(f"design: {len(theirs)} declarations   app: {len(ours)}")
    for label, group in (("only in the design", missing), ("only in the app", extra)):
        if group:
            print(f"\n{label}:")
            for declaration in group:
                print("   ", declaration)

    if missing or extra:
        return 1
    print("\ntypography matches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

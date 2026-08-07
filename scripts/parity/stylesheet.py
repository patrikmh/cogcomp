"""The design's stylesheet against the app's, rule by rule.

The screenshot harness answers "does this look right on the routes I looked at".
This answers the stricter question: does the app declare, for every selector the
design declares, the same properties with the same values. A rule the port
dropped is invisible until someone lands on the state that uses it — which is
how a whole `prefers-reduced-motion` block went missing once already.

    python3 scripts/parity/stylesheet.py path/to/tlon.html [--verbose]

Exits non-zero if the design declares a selector the app lacks, or declares a
property on a shared selector that the app declares differently.

Selectors the app deliberately adds are reported but never fail the check: this
is a port with real data behind it, and it legitimately needs states the mock
never had.
"""

import pathlib
import re
import sys

APP_CSS = pathlib.Path(__file__).resolve().parents[2] / "apps/web/src/styles/tlon.css"

#: Rules the app owns outright, with the reason. Each is a decision recorded in
#: a commit, not an accident, and the check should not keep reopening them.
OURS_BY_DESIGN = {
    # Verified separately: all fourteen custom properties in the design's
    # `:root` match `packages/design/tokens.css` exactly, values and all. The
    # exemption is for where they live, not for whether they agree.
    ":root": "the palette lives in packages/design, shared with the mobile client",
    ":focus-visible": "keyboard focus ring; the mock had no keyboard story",
    ".skip": "skip link past the rail; likewise",
    "#capText:focus-visible": "no ring on the autofocused composer",
    ".x-assess": "the completion note the design's outcome had nowhere to put",
}


def rules(css: str) -> dict[str, dict[str, str]]:
    """Selector -> {property: value}, with @-blocks flattened under a prefix.

    `@keyframes` are dropped: their `from`/`to` steps collide across different
    animations once flattened, and reported five differences that were three
    unrelated keyframes wearing each other's names.
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"@keyframes[^{]+\{(?:[^{}]|\{[^{}]*\})*\}", "", css)
    found: dict[str, dict[str, str]] = {}

    def collect(body: str, prefix: str = "") -> None:
        for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", body):
            selector = re.sub(r"\s+", " ", match.group(1)).strip()
            if selector.startswith("@"):
                continue
            declarations = {}
            for part in match.group(2).split(";"):
                if ":" not in part:
                    continue
                name, _, value = part.partition(":")
                declarations[name.strip()] = re.sub(r"\s+", " ", value).strip()
            if declarations:
                found.setdefault(prefix + selector, {}).update(declarations)

    # @media blocks first, so their rules are keyed apart from the base ones.
    for block in re.finditer(r"(@media[^{]+)\{((?:[^{}]|\{[^{}]*\})*)\}", css):
        collect(block.group(2), prefix=re.sub(r"\s+", "", block.group(1)) + " ")
    collect(re.sub(r"@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}", "", css))
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

    theirs = rules(style.group(1))
    ours = rules(APP_CSS.read_text())

    # A selector the app has widened — `.p-bar` added beside the design's list —
    # still covers the design's rule. Compare the parts, not the string.
    def covered(selector: str) -> str | None:
        if selector in ours:
            return selector
        wanted = {p.strip() for p in selector.split(",") if p.strip()}
        for mine in ours:
            if wanted <= {p.strip() for p in mine.split(",") if p.strip()}:
                return mine
        return None

    missing_selectors = [
        s for s in theirs if covered(s) is None and s not in OURS_BY_DESIGN
    ]
    differing: list[str] = []
    for selector, declarations in theirs.items():
        match = covered(selector)
        if match is None:
            continue
        for name, value in declarations.items():
            mine = ours[match].get(name)
            if mine is None:
                differing.append(f"{selector} · {name}: design {value!r}, app declares nothing")
            elif mine != value:
                differing.append(f"{selector} · {name}: design {value!r}, app {mine!r}")

    added = [s for s in ours if s not in theirs and s not in OURS_BY_DESIGN]

    print(f"design: {len(theirs)} selectors   app: {len(ours)}")
    for label, group in (
        ("selectors the design has and the app does not", missing_selectors),
        ("properties declared differently", differing),
    ):
        print(f"\n{label}: {len(group)}")
        for line in group[:40]:
            print("   ", line[:110])

    if "--verbose" in sys.argv:
        print(f"\nselectors the app adds ({len(added)}), reported only:")
        for selector in added[:40]:
            print("   ", selector[:110])

    return 1 if missing_selectors or differing else 0


if __name__ == "__main__":
    raise SystemExit(main())

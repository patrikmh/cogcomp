"""The palette, across the design and both clients.

`stylesheet.py` exempts `:root` on the grounds that it lives in
`packages/design` and was checked separately. Separately meant once, by hand,
which is not a check — it is a memory of having looked. Both clients read that
package precisely so they cannot drift, and nothing was verifying the thing they
cannot drift from.

    python3 scripts/parity/tokens.py '<design>/tlon.html'

Compares three sources and exits non-zero on any disagreement:

  * the design's own `:root` block
  * `packages/design/tokens.css`, which the web client imports
  * `packages/design/tokens.ts`, which the mobile client imports

A value the design has and the package lacks is a failure. A value the package
adds is reported but allowed: this is a port with real states the mock never
had, and it may legitimately need a step the design never named.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOKENS_CSS = ROOT / "packages/design/tokens.css"
TOKENS_TS = ROOT / "packages/design/tokens.ts"


def root_block(css: str) -> dict[str, str]:
    """`--name: value` pairs from the first `:root` rule."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    match = re.search(r":root\s*\{([^}]*)\}", css)
    if not match:
        return {}
    found = {}
    for line in match.group(1).split(";"):
        if ":" not in line:
            continue
        name, _, value = line.partition(":")
        if name.strip().startswith("--"):
            found[name.strip()] = value.strip().lower()
    return found


def ts_colours(source: str) -> dict[str, str]:
    """`name: "#hex"` pairs from the exported `colors` object."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    body = re.search(r"export const colors\s*=\s*\{(.*?)\n\}", source, re.S)
    if not body:
        return {}
    return {
        f"--{name}": value.lower()
        for name, value in re.findall(r"(\w+)\s*:\s*\"(#[0-9a-fA-F]{3,8})\"", body.group(1))
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    design_html = pathlib.Path(sys.argv[1]).read_text()
    style = re.search(r"<style>(.*?)</style>", design_html, re.S)
    if not style:
        print("no <style> block in the design file")
        return 2

    design = root_block(style.group(1))
    web = root_block(TOKENS_CSS.read_text())
    mobile = ts_colours(TOKENS_TS.read_text())

    print(f"design: {len(design)}   tokens.css: {len(web)}   tokens.ts: {len(mobile)}")

    problems: list[str] = []
    for name, value in sorted(design.items()):
        for label, other in (("tokens.css", web), ("tokens.ts", mobile)):
            mine = other.get(name)
            if mine is None:
                problems.append(f"{name}: design {value}, {label} has no such token")
            elif mine != value:
                problems.append(f"{name}: design {value}, {label} {mine}")

    # The two package files describe one palette; they must agree with each
    # other even where the design says nothing.
    for name in sorted(set(web) | set(mobile)):
        if web.get(name) != mobile.get(name):
            problems.append(f"{name}: tokens.css {web.get(name)}, tokens.ts {mobile.get(name)}")

    added = sorted(set(web) - set(design))
    print(f"\ndisagreements: {len(problems)}")
    for line in problems:
        print("   ", line)
    if added:
        print(f"\ntokens the package adds ({len(added)}), reported only: {', '.join(added)}")

    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())

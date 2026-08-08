"""Every stateful rule in the design, and whether it matches anything at all.

The stylesheet check says both sides *declare* the same rule. It cannot say the
rule ever applies. `.f-field` was declared identically on both sides and was
inert in this app for weeks, because the class sat on the input instead of the
wrapper the rule was written for — so the hover, focus and placeholder states
that hang off these selectors are exactly where that kind of fault survives a
rule-level diff.

This emits the base selectors (pseudo-classes and pseudo-elements stripped) so
they can be counted in a live page on both sides. A selector the design matches
and the app does not is a state the app cannot enter.

    python3 scripts/parity/states.py '<design>/tlon.html'
"""

import json
import pathlib
import re
import sys

# Longest alternative first: with `focus` ahead of `focus-within`, the regex
# eats the `:focus` and leaves `#cap-within` behind as a selector.
PSEUDO = (
    r"::?(focus-within|focus-visible|first-of-type|placeholder|disabled"
    r"|checked|active|hover|focus)"
)


def base(selector: str) -> str:
    """`#rail:not(:hover):not(:focus-within) .foot` -> `#rail .foot`."""
    selector = re.sub(r":not\([^)]*\)", "", selector)
    selector = re.sub(PSEUDO, "", selector)
    return re.sub(r"\s+", " ", selector).strip()


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    html = pathlib.Path(sys.argv[1]).read_text()
    css = re.search(r"<style>(.*?)</style>", html, re.S)
    if not css:
        print("no <style> block in the design file")
        return 2
    body = re.sub(r"/\*.*?\*/", "", css.group(1), flags=re.S)

    found: dict[str, str] = {}
    for rule in re.finditer(r"([^{}]+)\{([^{}]*)\}", body):
        selector = re.sub(r"\s+", " ", rule.group(1)).strip()
        if selector.startswith("@"):
            continue
        for part in selector.split(","):
            part = part.strip()
            if re.search(PSEUDO, part):
                found[part] = base(part)

    print(json.dumps(found, indent=0, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

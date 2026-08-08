() => {
  // The shape of the page, as parent → child paths of styled things.
  //
  // A class-set diff says which classes exist. It cannot say that the design
  // nests `#dock > #cap > textarea` where the app puts the id on the textarea
  // itself — same classes, different tree, and every descendant rule silently
  // stops matching. This walks the tree and records each styled node's path,
  // so the comparison is about structure rather than vocabulary.
  //
  // Ids are reported apart from structure. Nearly every id in the design is a
  // handle for its own imperative JS — `#wpeek`, `#qcount`, `#newx`, `#capState`
  // — and React replaces those with state. Counting them as structural
  // differences buried the real ones: settings read as four differences when
  // its tree is identical to the design's, and the one difference that mattered
  // on identity read as the same size as three id hooks beside it. Structure is
  // the number to watch; ids are a list to skim.
  const classesOf = (el) =>
    String(el.className?.baseVal ?? el.className ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .map((c) => "." + c)
      .join("");

  const paths = new Set();
  const ids = new Set();
  const walk = (el, trail) => {
    const here = el.tagName.toLowerCase() + classesOf(el);
    // Only remember nodes that carry an id or class — a bare <div> used for
    // layout is not something the design can be said to have or lack.
    const next = el.id || el.className ? [...trail, here].slice(-3) : trail;
    if (el.id || el.className) paths.add(next.join(" > "));
    if (el.id) ids.add("#" + el.id);
    for (const child of el.children) walk(child, next);
  };

  const root = document.querySelector("#app") || document.body;
  walk(root, []);
  return [...paths].sort().join("\n") + "\n--- ids ---\n" + [...ids].sort().join("\n");
}

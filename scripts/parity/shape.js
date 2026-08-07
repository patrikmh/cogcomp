() => {
  // The shape of the page, as parent → child paths of styled things.
  //
  // A class-set diff says which classes exist. It cannot say that the design
  // nests `#dock > #cap > textarea` where the app puts the id on the textarea
  // itself — same classes, different tree, and every descendant rule silently
  // stops matching. This walks the tree and records each styled node's path,
  // so the comparison is about structure rather than vocabulary.
  const label = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = String(el.className?.baseVal ?? el.className ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .map((c) => "." + c)
      .join("");
    return el.tagName.toLowerCase() + id + cls;
  };

  const paths = new Set();
  const walk = (el, trail) => {
    const here = label(el);
    // Only remember nodes that carry an id or class — a bare <div> used for
    // layout is not something the design can be said to have or lack.
    const next = el.id || el.className ? [...trail, here].slice(-3) : trail;
    if (el.id || el.className) paths.add(next.join(" > "));
    for (const child of el.children) walk(child, next);
  };

  const root = document.querySelector("#app") || document.body;
  walk(root, []);
  return [...paths].sort().join("\n");
}

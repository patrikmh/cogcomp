() => {
  // The written copy on a screen, separated from the data on it.
  //
  // Headings, captions, section labels and button text are authored; entry
  // text, labels and counts come from the record and will never match between
  // a mock and a real account. This takes the authored parts: anything inside
  // an element that has no numbers in it and is not an entry's own words.
  // `p` and `li` are here because they were not, and the check reported /words
  // clean while comparing none of it. That page is almost entirely paragraphs
  // inside cards — what is stored, what is sent to a model, what happens to
  // audio — and a carrier list of headings and buttons could not see a word of
  // it. The page whose whole content is prose was the page the prose check
  // skipped.
  const carriers =
    "h1, h2, h3, p, li, .kicker, .sub, .rest, .btn, button, .clab, .t-sec .mono, .empty, .id-cap .rest, .w-peek, .p-peek";
  const out = [];
  for (const el of document.querySelectorAll(carriers)) {
    const text = el.textContent.replace(/\s+/g, " ").trim();
    if (!text || text.length > 220) continue;
    // Drop anything that is mostly a number or a date — that is the record
    // talking, not the design.
    const digits = (text.match(/\d/g) || []).length;
    if (digits > text.length / 6) continue;
    out.push(text);
  }
  return [...new Set(out)].sort().join("\n");
}

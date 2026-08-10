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
    // Compared as sentences, not as elements. The design puts "Every node opens
    // to its evidence." on its own where the app prefixes it with "Hover a
    // point to name it.", and packages the identity and settings notes
    // differently again — all three reported as missing copy when all three
    // were present, because an element-sized comparison cannot see that one
    // side merged two sentences the other kept apart.
    for (const sentence of text.split(/(?<=[.?!])\s+(?=[A-Z“"])/)) {
      const line = sentence.trim();
      if (line.length >= 12) out.push(line);
    }
  }
  return [...new Set(out)].sort().join("\n");
}

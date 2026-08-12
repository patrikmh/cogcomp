import { GUIDES, guideBody } from "@tlon/copy/guides";
import { useEffect, useRef, useState } from "react";

/**
 * A "?" beside a heading, and one sentence behind it.
 *
 * The design puts this on every screen that makes a claim, and the sentences
 * say what the screen shows *and* where it stops — "a pattern is not a
 * diagnosis or a cause", "positions are not meaning". An app that draws
 * conclusions about someone has to be able to say where its conclusions end,
 * at the point where it is making them.
 *
 * The dialog is the design's: a backdrop that fades, a bordered plate, a close
 * mark in the corner. Escape shuts it, focus is trapped inside it while it is
 * open and returns to the "?" when it closes, because a dialog you can tab out
 * of behind the backdrop is a trap of a different kind.
 */
export function Guide({ id, lens }: { id: string; lens?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const entry = GUIDES[id];

  useEffect(() => {
    document.body.classList.toggle("guide-open", open);
    if (!open) return;

    const focusables = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])") ??
          [],
      );
    focusables()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? at <= 0
          ? items.length - 1
          : at - 1
        : at === items.length - 1
          ? 0
          : at + 1;
      event.preventDefault();
      items[next]?.focus();
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("guide-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!entry) return null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="guide-trigger"
        aria-label={`About ${entry.title}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        ?
      </button>

      {open && (
        <div
          id="guide-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            id="guide-dialog"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
          >
            <h2 id="guide-title">{entry.title}</h2>
            <p>{guideBody(id, lens)}</p>
            <button
              id="guide-close"
              type="button"
              className="guide-trigger"
              aria-label="Close"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}

import { GUIDES, guideBody } from "@tlon/copy/guides";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * A "?" beside a heading, and one sentence behind it.
 *
 * The design puts this on every screen that makes a claim, and the sentences
 * say what the screen shows *and* where it stops — "a pattern is not a
 * diagnosis or a cause", "positions are not meaning". An app that draws
 * conclusions about someone has to be able to say where its conclusions end, at
 * the point where it is making them.
 *
 * There is one dialog, in the shell, and any number of triggers — which is how
 * the design has it and is not incidental. `#guide-backdrop` fades on an
 * opacity-and-visibility transition, so it has to be in the document before it
 * is asked to appear: an element mounted at the moment it becomes visible has
 * nothing to transition from, and the guide appeared rather than arriving.
 */
interface GuideControl {
  open: (key: string, lens: string | undefined, from: HTMLElement | null) => void;
}

const GuideContext = createContext<GuideControl | null>(null);

/** The single dialog, mounted once by the shell. */
export function GuideHost({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState<{ key: string; lens?: string } | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const open = useCallback((key: string, lens: string | undefined, from: HTMLElement | null) => {
    returnTo.current = from;
    setShown({ key, lens });
  }, []);

  const shut = useCallback(() => {
    setShown(null);
    returnTo.current?.focus();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("guide-open", shown !== null);
    if (!shown) return;

    const focusables = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button, [href], [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
    focusables()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        shut();
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
  }, [shown, shut]);

  const entry = shown ? GUIDES[shown.key] : undefined;

  return (
    <GuideContext.Provider value={{ open }}>
      {children}
      <div
        id="guide-backdrop"
        aria-hidden={shown ? "false" : "true"}
        onClick={(event) => {
          if (event.target === event.currentTarget) shut();
        }}
      >
        <section
          id="guide-dialog"
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="guide-title"
          tabIndex={-1}
        >
          <button
            id="guide-close"
            className="guide-trigger"
            type="button"
            aria-label="Close guide"
            onClick={shut}
          >
            ×
          </button>
          <h2 id="guide-title">{entry?.title ?? "Guide"}</h2>
          <p id="guide-body">{shown ? guideBody(shown.key, shown.lens) : ""}</p>
        </section>
      </div>
    </GuideContext.Provider>
  );
}

/** The "?" itself. Says which screen it is about; the shell holds the dialog. */
export function Guide({ id, lens }: { id: string; lens?: string }) {
  const control = useContext(GuideContext);
  const entry = GUIDES[id];
  if (!entry || !control) return null;

  return (
    <button
      type="button"
      className="guide-trigger"
      aria-label={`About ${entry.title}`}
      onClick={(event) => control.open(id, lens, event.currentTarget)}
    >
      ?
    </button>
  );
}

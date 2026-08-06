/** The three things a data screen can be, said plainly.
 *  An empty state states the fact and stops — it never suggests writing more. */
export function Loading({ label = "Reading…" }: { label?: string }) {
  return <div className="empty mono">{label}</div>;
}

export function Failed({ label = "Could not load this." }: { label?: string }) {
  return (
    <div className="empty mono" role="alert">
      {label}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return <div className="empty">{label}</div>;
}

/** The three things a data screen can be, said plainly.
 *  An empty state states the fact and stops — it never suggests writing more. */
export function Loading({ label = "Reading…" }: { label?: string }) {
  return <div className="empty mono">{label}</div>;
}

export function Failed({
  label = "Could not load this.",
  onRetry,
}: {
  label?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="empty mono" role="alert">
      <span>{label}</span>
      {onRetry && (
        <button className="btn ghost" type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return <div className="empty">{label}</div>;
}

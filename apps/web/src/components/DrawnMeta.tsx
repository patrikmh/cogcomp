import { Link } from "react-router-dom";

import { feltThoughtOf, heldReadingsOf, outerReadingsOf } from "@/lib/drawn-from";
import { fmt } from "@/lib/format";
import { SECTIONS } from "@tlon/copy/sections";
import type { Drawn } from "@tlon/ontology";

/**
 * What one act left behind, in rooms.
 *
 * A mixed chip row lets five activities bury a need. The rooms are the same
 * ones the rest of the record uses, so a hold stays a hold wherever the act
 * is shown.
 */
export function DrawnMeta({
  readings,
  confidence = false,
}: {
  readings: readonly Drawn[];
  confidence?: boolean;
}) {
  const rooms = [
    { name: "inside" as const, items: feltThoughtOf(readings) },
    { name: "holds" as const, items: heldReadingsOf(readings) },
    { name: "around" as const, items: outerReadingsOf(readings) },
  ].filter((room) => room.items.length > 0);

  return (
    <>
      {rooms.map((room) => (
        <div className="j-meta" key={room.name}>
          <span className="j-from">{SECTIONS[room.name].title.toLowerCase()}</span>
          {room.items.map((reading) => (
            <Link
              key={reading.id}
              className={`j-chip${reading.tentative ? " ghost" : ""}`}
              to={`/node/${reading.id}`}
            >
              {confidence ? `${reading.label} · ${fmt(reading.confidence)}` : reading.label}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}

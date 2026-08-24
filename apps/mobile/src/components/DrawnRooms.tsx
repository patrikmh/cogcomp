import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { Chip, Kicker } from "@/components/Marks";
import { feltThoughtOf, heldReadingsOf, outerReadingsOf } from "@/lib/drawnFrom";
import { SECTIONS } from "@tlon/copy/sections";

/**
 * What one act left behind, in rooms.
 *
 * A mixed chip row lets four activities bury a need. The rooms are the same
 * ones the rest of the record uses, so a hold stays a hold wherever the act
 * is shown.
 */
export function DrawnRooms({
  readings,
  ask,
  aroundCap = 3,
}: {
  readings: readonly {
    id: string;
    kind: string;
    label: string;
    confidence: number;
    tentative: boolean;
  }[];
  ask?: boolean;
  aroundCap?: number;
}) {
  const router = useRouter();
  const rooms = [
    { name: "inside" as const, items: feltThoughtOf(readings) },
    { name: "holds" as const, items: heldReadingsOf(readings) },
    { name: "around" as const, items: outerReadingsOf(readings).slice(0, aroundCap) },
  ].filter((room) => room.items.length > 0);
  if (rooms.length === 0) return null;

  return (
    <View style={styles.stack}>
      {ask && <Kicker>Drawn from this · does it fit?</Kicker>}
      {rooms.map((room) => (
        <View key={room.name} style={styles.chipRow}>
          <Kicker>{SECTIONS[room.name].title}</Kicker>
          <View style={styles.chips}>
            {room.items.map((reading) => (
              <Chip
                key={reading.id}
                label={reading.label}
                confidence={reading.confidence}
                tentative={reading.tentative}
                onPress={() => router.push(`/node/${reading.id}`)}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  chipRow: { gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});

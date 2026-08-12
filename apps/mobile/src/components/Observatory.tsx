import { Suspense, type ReactNode } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { lazySkia } from "@/lib/lazySkia";
import type { Datum } from "@/lib/orbital";
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";
import { Kicker } from "@/components/Marks";
import { Seal } from "@/components/Seal";

const LazyConstellation = lazySkia(() => import("@/components/Constellation"));

/**
 * The shape every screen has.
 *
 * One object in the middle, one line of context above it, one readout below. The
 * readout is empty until you point at something, and then it describes exactly
 * that one thing.
 *
 * The rule this enforces is subtraction. Screens accumulate: a kicker, a title,
 * an intro paragraph, a decorative flourish, a button, a legend, then the actual
 * data at the bottom. Everything above the data was written to explain a screen
 * that would not need explaining if it showed less. Here there is nowhere to put
 * that, so it does not get written.
 *
 * What does *not* get subtracted is the epistemic framing — tentative points stay
 * hollow, confidence stays on the readout, and provenance is always one tap away.
 * Showing less has to mean showing fewer things at once, never showing a guess as
 * though it were a fact.
 */

interface Props {
  /** Two or three words. Where you are, not what to do. Omitted on screens whose
   *  navigation header already says it — the same word twice, six pixels apart,
   *  is the kind of thing that makes a screen feel busy for no reason. */
  eyebrow?: string;
  data: Datum[];
  links?: { from: string; to: string }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** The readout for the selected point. Null when nothing is selected. */
  detail: ReactNode;
  /** One short line, shown only while nothing is selected. */
  hint?: string;
  /** Shown instead of the object when there is nothing yet. One sentence, and
   *  never a nudge to write more. */
  empty?: string;
  loading?: boolean;
  error?: string | null;
  /** A single optional action, at the very bottom. */
  action?: { label: string; onPress: () => void; pending?: boolean };
  secondaryAction?: { label: string; onPress: () => void };
  dotSize?: number;
  /** Draw the scene inside a head. See Constellation. */
  frame?: "none" | "head";
}

export function Observatory({
  eyebrow,
  data,
  links,
  selected,
  onSelect,
  detail,
  hint,
  empty,
  loading = false,
  error = null,
  action,
  secondaryAction,
  dotSize,
  frame = "head",
}: Props) {
  const { width, height } = useWindowDimensions();
  // Square, and bounded so the object never crowds the readout on a short screen
  // or float lost in the middle of a tall one.
  const size = Math.min(width * 0.92, height * 0.58, 480);

  return (
    <View style={styles.screen}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}

      <View style={styles.stage}>
        {loading ? (
          <ActivityIndicator color={colors.violet} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : data.length === 0 ? (
          <Text style={styles.empty}>{empty}</Text>
        ) : (
          <Suspense fallback={<View style={{ width: size, height: size }} />}>
            <LazyConstellation
              data={data}
              links={links}
              size={size}
              selected={selected}
              onSelect={onSelect}
              dotSize={dotSize}
              frame={frame}
            />
          </Suspense>
        )}
      </View>

      <View style={styles.readout}>
        {detail ?? (hint ? <Text style={styles.hint}>{hint}</Text> : null)}
      </View>

      {action && (
        <MotionSurface
          style={[styles.action, action.pending && styles.pending]}
          disabled={action.pending}
          onPress={action.onPress}
          accessibilityRole="button"
        >
          <Text style={styles.actionLabel}>{action.label}</Text>
        </MotionSurface>
      )}
      {secondaryAction && <MotionSurface onPress={secondaryAction.onPress} accessibilityRole="link" style={styles.secondaryAction}><Text style={styles.open}>{secondaryAction.label}</Text></MotionSurface>}
    </View>
  );
}

/**
 * The readout for one selected thing.
 *
 * Kind and confidence on one line, the person's own words on the next, and a way
 * through to where it came from. Nothing else fits, which is the point — if a
 * fourth thing needs saying it belongs on the screen you tap through to.
 */
export function Readout({
  tone,
  label,
  meta,
  tentative = false,
  onOpen,
  openLabel = "Where this came from →",
  sealId,
}: {
  tone: string;
  label: string;
  meta?: string;
  tentative?: boolean;
  onOpen?: () => void;
  openLabel?: string;
  /** The thing's id, so it can be stamped with its own mark. */
  sealId?: string;
}) {
  return (
    <View style={styles.detail}>
      {/* Every screen that points at one thing shows the same mark for it —
          patterns, identity, headspace, agents and explore all read out through
          here, so this is one seal in five places rather than five decisions. */}
      <View style={styles.detailHead}>
        {sealId ? <Seal id={sealId} size={26} /> : null}
        <Kicker>
          {tone}
          {meta ? ` · ${meta}` : ""}
          {tentative ? " · tentative" : ""}
        </Kicker>
      </View>
      <Text style={styles.detailLabel} numberOfLines={3}>
        {label}
      </Text>
      {onOpen && (
        <MotionSurface onPress={onOpen} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.open}>{openLabel}</Text>
        </MotionSurface>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room, paddingHorizontal: 20 },
  // The design's kicker, not a green heading. Five screens share this one
  // style — headspace, patterns, agents, identity, explore — so they all read
  // as markings on the side of the instrument rather than as five titles
  // shouting in the product's accent colour.
  eyebrow: {
    color: colors.inkMuted,
    fontFamily: fonts.monoMedium,
    fontSize: scale.kicker.size,
    lineHeight: scale.kicker.line,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
    paddingTop: 14,
  },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  readout: { minHeight: 104, justifyContent: "flex-start", paddingBottom: 4 },
  hint: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  empty: {
    color: colors.inkMuted,
    fontFamily: fonts.sans, fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 300,
  },
  error: { color: colors.danger, fontFamily: fonts.sans, fontSize: 14 },
  detailHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  detail: { gap: 5 },
  detailLabel: { color: colors.ink, fontFamily: fonts.sans, fontSize: 19, lineHeight: 26 },
  open: { color: colors.cyan, fontFamily: fonts.sans, fontSize: 13, fontWeight: "700", paddingTop: 2 },
  action: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 3,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 18,
  },
  pending: { opacity: 0.45 },
  actionLabel: { color: colors.ink, fontFamily: fonts.sans, fontSize: 15, fontWeight: "700" },
  secondaryAction: { alignItems: "center", paddingBottom: 18 },
});

import { GLYPHS, GLYPH_VIEWBOX, type GlyphName } from "@tlon/design/icons";
import Svg, { Circle, Path } from "react-native-svg";

import { colors } from "@/theme";

/**
 * One of the design's navigation marks.
 *
 * Stroked at 1.4 on a 24 grid, which is what the design draws them at; a dot
 * the design fills stays filled, because those are points rather than rings.
 */
export function Glyph({
  name,
  size = 22,
  tone = colors.inkMuted,
}: {
  name: GlyphName;
  size?: number;
  tone?: string;
}) {
  const glyph: { circles?: { cx: number; cy: number; r: number; solid?: boolean }[]; paths?: string[] } =
    GLYPHS[name];

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}>
      {(glyph.paths ?? []).map((d, i) => (
        <Path
          key={`p${i}`}
          d={d}
          fill="none"
          stroke={tone}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {(glyph.circles ?? []).map((c, i) => (
        <Circle
          key={`c${i}`}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          fill={c.solid ? tone : "none"}
          stroke={c.solid ? "none" : tone}
          strokeWidth={1.4}
        />
      ))}
    </Svg>
  );
}

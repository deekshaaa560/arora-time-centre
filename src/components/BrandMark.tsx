import { ClockMark, MARK_HEIGHT, MARK_WIDTH } from "./brandArt";

type BrandMarkProps = {
  /** Rendered width in pixels; the mark keeps its 160 : 112 proportions. */
  size?: number;
  className?: string;
  /** Thicker strokes for small sizes (nav, favicon-style usage). */
  bold?: boolean;
};

/**
 * The Arora Time Centre mark: the top of a watch dial with a white minute
 * track and hands set to 10:10. The full identity lives in BrandLockup.
 */
export default function BrandMark({
  size = 48,
  className = "",
  bold = false,
}: BrandMarkProps) {
  return (
    <svg
      viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
      width={size}
      height={(size * MARK_HEIGHT) / MARK_WIDTH}
      className={className}
      role="img"
      aria-label="Arora Time Centre"
      focusable="false"
    >
      <title>Arora Time Centre</title>
      <ClockMark stroke="#ffffff" bold={bold} />
    </svg>
  );
}

/**
 * Shared artwork for the Arora Time Centre identity.
 *
 * The mark is the top of a watch dial: an arc, a minute track and the hands
 * resting in the classic 10:10 pose. It is drawn in a 160 × 112 box so it can
 * be embedded in the lockups as well as used on its own.
 */

export const MARK_WIDTH = 160;
export const MARK_HEIGHT = 112;

const CX = 80;
const CY = 100;
const R = 66;

const polar = (degrees: number, radius: number) => {
  const rad = (degrees * Math.PI) / 180;
  return {
    x: CX + radius * Math.sin(rad),
    y: CY - radius * Math.cos(rad),
  };
};

const arcStart = polar(265, R);
const arcEnd = polar(95, R);

const ARC_PATH = `M${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)}A${R} ${R} 0 1 1 ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`;

/** 31 minute marks over the open dial; every fifth mark is an hour index. */
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const degrees = i * 6;
  const rad = (degrees * Math.PI) / 180;
  // only the part of the track that follows the arc (ends just past 3 & 9)
  if (Math.cos(rad) < -0.05) return null;

  const major = i % 5 === 0;
  const inner = polar(degrees, major ? 45 : 53.5);
  const outer = polar(degrees, 60);

  return {
    x1: inner.x,
    y1: inner.y,
    x2: outer.x,
    y2: outer.y,
    width: major ? 2.6 : 1.35,
    opacity: major ? 0.75 : 0.45,
  };
}).filter((tick): tick is NonNullable<typeof tick> => tick !== null);

const HOUR_HAND = (() => {
  const tip = polar(305, 43);
  const tail = polar(125, 9);
  return `M${tail.x.toFixed(2)} ${tail.y.toFixed(2)}L${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`;
})();

const MINUTE_HAND = (() => {
  const tip = polar(60, 59);
  const tail = polar(240, 7);
  return `M${tail.x.toFixed(2)} ${tail.y.toFixed(2)}L${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`;
})();

type ClockMarkProps = {
  /** Stroke colour for the dial. The lockups pass white. */
  stroke: string;
  bold?: boolean;
};

/** The arc-and-hands mark, drawn in the local 160 × 112 coordinate space. */
export function ClockMark({ stroke, bold = false }: ClockMarkProps) {
  return (
    <g>
      <path
        d={ARC_PATH}
        fill="none"
        stroke={stroke}
        strokeWidth={bold ? 2.8 : 1.9}
        strokeLinecap="round"
        opacity="0.95"
      />

      <g stroke={stroke} strokeLinecap="round">
        {TICKS.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            strokeWidth={bold ? tick.width * 1.45 : tick.width}
            opacity={tick.opacity}
          />
        ))}
      </g>

      <g stroke={stroke} strokeLinecap="round">
        <path d={HOUR_HAND} strokeWidth={bold ? 4.4 : 3.2} />
        <path d={MINUTE_HAND} strokeWidth={bold ? 2.6 : 1.9} />
      </g>

      <circle cx={CX} cy={CY} r={3.5} fill="none" stroke={stroke} strokeWidth={bold ? 2.3 : 1.6} />
      <circle cx={CX} cy={CY} r={1.25} fill={stroke} />
    </g>
  );
}

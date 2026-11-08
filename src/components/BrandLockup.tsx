import { ClockMark } from "./brandArt";
import BrandMark from "./BrandMark";

type BrandLockupProps = {
  /** Rendered width in pixels. The height follows the lockup proportions. */
  size?: number;
  variant?: "horizontal" | "stacked" | "compact";
  className?: string;
  /** Thicker dial strokes for small sizes (navbar). */
  bold?: boolean;
};

const HORIZONTAL = { width: 384, height: 120 };
const STACKED = { width: 390, height: 390 };

const FONT_DISPLAY = "Cinzel, 'Playfair Display', Georgia, serif";
const FONT_BODY = "Inter, system-ui, sans-serif";
const FONT_LOCATION = "'Playfair Display', Georgia, serif";

/**
 * The uploaded Arora Time Centre logo, rebuilt as a crisp white vector lockup.
 *
 * - horizontal: arc mark + ARORA / TIME CENTRE / Patel Nagar (navbar)
 * - stacked:    arc above the centred three-line wordmark (footer, hero)
 * - compact:    arc mark on its own
 */
export default function BrandLockup({
  size = 160,
  variant = "horizontal",
  className = "",
  bold = false,
}: BrandLockupProps) {
  if (variant === "compact") {
    return <BrandMark size={size} className={className} bold={bold} />;
  }

  const isStacked = variant === "stacked";
  const box = isStacked ? STACKED : HORIZONTAL;

  return (
    <svg
      viewBox={`0 0 ${box.width} ${box.height}`}
      width={size}
      height={(size * box.height) / box.width}
      className={className}
      role="img"
      aria-label="Arora Time Centre — Patel Nagar"
      focusable="false"
    >
      <title>Arora Time Centre — Patel Nagar</title>

      {isStacked ? (
        <>
          <g transform="translate(8.33 -59.33) scale(2.3333)">
            <ClockMark stroke="#ffffff" bold={bold} />
          </g>

          <text
            x="195"
            y="292"
            textAnchor="middle"
            fontFamily={FONT_DISPLAY}
            fontWeight="700"
            fontSize="120"
            textLength="380"
            lengthAdjust="spacing"
            fill="#ffffff"
          >
            ARORA
          </text>
          <text
            x="195"
            y="328"
            textAnchor="middle"
            fontFamily={FONT_BODY}
            fontWeight="500"
            fontSize="28"
            textLength="300"
            lengthAdjust="spacing"
            fill="#ffffff"
          >
            TIME CENTRE
          </text>
          <text
            x="195"
            y="374"
            textAnchor="middle"
            fontFamily={FONT_LOCATION}
            fontWeight="500"
            fontSize="38"
            textLength="200"
            lengthAdjust="spacing"
            fill="#ffffff"
          >
            Patel Nagar
          </text>
        </>
      ) : (
        <>
          <g transform="translate(4 6) scale(0.85)">
            <ClockMark stroke="#ffffff" bold={bold} />
          </g>

          <text
            x="150"
            y="64"
            fontFamily={FONT_DISPLAY}
            fontWeight="700"
            fontSize="54"
            textLength="222"
            lengthAdjust="spacing"
            fill="#ffffff"
          >
            ARORA
          </text>
          <text
            x="150"
            y="90"
            fontFamily={FONT_BODY}
            fontWeight="500"
            fontSize="16"
            textLength="205"
            lengthAdjust="spacing"
            fill="#ffffff"
          >
            TIME CENTRE
          </text>
          <text
            x="150"
            y="112"
            fontFamily={FONT_LOCATION}
            fontWeight="500"
            fontSize="19"
            textLength="128"
            lengthAdjust="spacing"
            fill="#ffffff"
          >
            Patel Nagar
          </text>
        </>
      )}
    </svg>
  );
}

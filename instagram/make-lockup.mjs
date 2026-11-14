import fs from "node:fs";

// Rebuild the actual Arora Time Centre lockup (arc + wordmark) from the
// site's BrandLockup component, at display size (non-bold dial strokes).

const MARK_WIDTH = 160;
const MARK_HEIGHT = 112;
const CX = 80;
const CY = 100;
const R = 66;

const polar = (degrees, radius) => {
  const rad = (degrees * Math.PI) / 180;
  return {
    x: CX + radius * Math.sin(rad),
    y: CY - radius * Math.cos(rad),
  };
};

const arcStart = polar(265, R);
const arcEnd = polar(95, R);
const ARC_PATH = `M${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)}A${R} ${R} 0 1 1 ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`;

const ticks = Array.from({ length: 60 }, (_, i) => {
  const degrees = i * 6;
  const rad = (degrees * Math.PI) / 180;
  if (Math.cos(rad) < -0.05) return null;

  const major = i % 5 === 0;
  const inner = polar(degrees, major ? 45 : 53.5);
  const outer = polar(degrees, 60);

  return `<line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" stroke-width="${major ? 2.6 : 1.35}" opacity="${major ? 0.75 : 0.45}" />`;
}).filter(Boolean).join("");

const hourTip = polar(305, 43);
const hourTail = polar(125, 9);
const minuteTip = polar(60, 59);
const minuteTail = polar(240, 7);

const mark = `<g transform="translate(4 6) scale(0.85)">
  <path d="${ARC_PATH}" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" opacity="0.95" />
  <g stroke="#ffffff" stroke-linecap="round">${ticks}</g>
  <g stroke="#ffffff" stroke-linecap="round">
    <path d="M${hourTail.x.toFixed(2)} ${hourTail.y.toFixed(2)}L${hourTip.x.toFixed(2)} ${hourTip.y.toFixed(2)}" stroke-width="3.2" />
    <path d="M${minuteTail.x.toFixed(2)} ${minuteTail.y.toFixed(2)}L${minuteTip.x.toFixed(2)} ${minuteTip.y.toFixed(2)}" stroke-width="1.9" />
  </g>
  <circle cx="${CX}" cy="${CY}" r="3.5" fill="none" stroke="#ffffff" stroke-width="1.6" />
  <circle cx="${CX}" cy="${CY}" r="1.25" fill="#ffffff" />
</g>`;

const lockup = `<svg class="lockup" viewBox="0 0 ${MARK_WIDTH + 224} 120" role="img" aria-label="Arora Time Centre — Patel Nagar" focusable="false">
  <title>Arora Time Centre — Patel Nagar</title>
  ${mark}
  <text x="150" y="64" font-family="Cinzel, 'Playfair Display', Georgia, serif" font-weight="700" font-size="54" textLength="222" lengthAdjust="spacing" fill="#ffffff">ARORA</text>
  <text x="150" y="90" font-family="Inter, system-ui, sans-serif" font-weight="500" font-size="16" textLength="205" lengthAdjust="spacing" fill="#ffffff">TIME CENTRE</text>
  <text x="150" y="112" font-family="'Playfair Display', Georgia, serif" font-weight="500" font-size="19" textLength="128" lengthAdjust="spacing" fill="#ffffff">Patel Nagar</text>
</svg>`;

const htmlPath = new URL("./launch-story.html", import.meta.url);
let html = fs.readFileSync(htmlPath, "utf8");

const replaced = html.replace(
  /[ \t]*<img\s+class="lockup"[\s\S]*?\/>/,
  `      ${lockup.replace(/\n/g, "\n      ")}`,
);

if (replaced === html) {
  throw new Error("Lockup <img> not found in launch-story.html");
}

fs.writeFileSync(htmlPath, replaced);
fs.mkdirSync(new URL("./assets/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("./assets/arora-lockup-actual.svg", import.meta.url), lockup + "\n");

console.log("Inline lockup written; standalone SVG saved to instagram/assets/arora-lockup-actual.svg");

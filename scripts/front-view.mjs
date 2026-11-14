/**
 * Front-view detector, shared by the audit and the image pipelines.
 *
 * The shop only wants photos where the dial faces the camera. Two signals
 * separate a front shot from a side profile / back case / bracelet-only crop:
 *
 *  1. Size of the round blob. The silhouette (everything not reachable from the
 *     image border through white pixels, so a pale dial counts as watch) holds
 *     a large inscribed circle when the case faces the lens; a profile is a
 *     thin band and a curled bracelet is a narrow loop.
 *  2. Detail inside that circle. A dial is hands, indices, printed logo and a
 *     chapter ring, so the disc is edge-rich. A polished case flank, a serial
 *     back or the empty middle of a coiled bracelet is edge-poor.
 *
 *   classifyCanvas(canvas) -> { front, frontScore, reason, ... }
 */
import sharp from "sharp";

const W = 800;
const H = 800;

/** Same white 800x800 scoring canvas the image pipelines use. */
export async function scoringCanvas(buffer) {
  const base = await sharp(buffer).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  let trimmed = base;
  try {
    trimmed = await sharp(base).trim({ threshold: 8 }).png().toBuffer();
  } catch {
    /* uniform image */
  }
  const info = await sharp(trimmed).metadata();
  const scale = Math.min(760 / info.width, 760 / info.height);
  const resized = await sharp(trimmed)
    .resize(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)), {
      fit: "inside",
    })
    .png()
    .toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite([{ input: resized, gravity: "center" }])
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/** Luminance per pixel. */
function luma({ data, info }) {
  const n = info.width * info.height;
  const l = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    l[i] = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
  }
  return l;
}

/**
 * Watch pixels = everything the white background cannot reach from the border.
 * Flooding the background instead of thresholding keeps pale dials and brushed
 * metal inside the shape while still treating the tile as white.
 */
export function watchMask(lum, w = W, h = H, whiteAt = 238) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => {
    if (!seen[i] && lum[i] >= whiteAt) {
      seen[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (sp) {
    const p = stack[--sp];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = seen[i] ? 0 : 1;
  return mask;
}

/**
 * Every separate object in the frame, biggest first. `mainComponent` is the first
 * entry. A couple-pack photograph - one watch front-on beside one showing its back -
 * is two components, and the way to rescue it is to cut out the one that is a dial,
 * which is what scripts/crop-front.mjs does.
 */
export function allComponents(mask, w = W, h = H, minAreaFrac = 0) {
  const labels = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const found = [];
  let id = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i] >= 0) continue;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = id;
    let area = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && labels[q] < 0) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
    }
    if (area >= minAreaFrac * w * h) found.push({ id, area, minX, minY, maxX, maxY });
    id++;
  }
  found.sort((a, b) => b.area - a.area);
  for (const c of found) {
    c.own = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) c.own[i] = mask[i] && labels[i] === c.id ? 1 : 0;
  }
  return found;
}

/** Largest connected blob of the mask (the watch itself). */
export function mainComponent(mask, w = W, h = H) {
  return allComponents(mask, w, h)[0] || null;
}

/** Two-pass chamfer (3,4) distance from every pixel to the nearest edge. */
function distanceToEdge(mask, w = W, h = H) {
  const D = new Float64Array(w * h).fill(1e9);
  for (let i = 0; i < w * h; i++) if (!mask[i]) D[i] = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = D[y * w + x];
      if (x > 0) v = Math.min(v, D[y * w + x - 1] + 3);
      if (y > 0) v = Math.min(v, D[(y - 1) * w + x] + 3);
      if (x > 0 && y > 0) v = Math.min(v, D[(y - 1) * w + x - 1] + 4);
      if (x < w - 1 && y > 0) v = Math.min(v, D[(y - 1) * w + x + 1] + 4);
      D[y * w + x] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      let v = D[y * w + x];
      if (x < w - 1) v = Math.min(v, D[y * w + x + 1] + 3);
      if (y < h - 1) v = Math.min(v, D[(y + 1) * w + x] + 3);
      if (x < w - 1 && y < h - 1) v = Math.min(v, D[(y + 1) * w + x + 1] + 4);
      if (x > 0 && y < h - 1) v = Math.min(v, D[(y + 1) * w + x - 1] + 4);
      D[y * w + x] = v;
    }
  return D;
}

/** What is inside the biggest round blob: a dial is busy, dark and ringed. */
function discStats(lum, cx, cy, r) {
  const rad = Math.max(4, r * 0.9);
  // Inside the disc, ignoring the outermost band so the case edge itself is not
  // counted: dials carry hands and metal indices (hard edges), an engraved case
  // back only has soft etching. Measured as the 99th-percentlel gradient.
  const hist = new Int32Array(64);
  let inner = 0;
  const innerRad = r * 0.8;
  const innerRad2 = innerRad * innerRad;
  let n = 0;
  let strong = 0;
  let dark = 0;
  let sum = 0;
  for (let y = Math.max(1, Math.floor(cy - rad)); y < Math.min(H - 1, Math.ceil(cy + rad)); y++) {
    for (let x = Math.max(1, Math.floor(cx - rad)); x < Math.min(W - 1, Math.ceil(cx + rad)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > rad * rad) continue;
      const i = y * W + x;
      const gx = Math.abs(lum[i + 1] - lum[i - 1]);
      const gy = Math.abs(lum[i + W] - lum[i - W]);
      n++;
      if (gx + gy > 26) strong++;
      if (lum[i] < 70) dark++;
      sum += lum[i];
      if (dx * dx + dy * dy <= innerRad2) {
        inner++;
        hist[Math.min(63, (gx + gy) >> 2)]++;
      }
    }
  }
  if (!n) return { detail: 0, darkFrac: 0, bright: 1, sharpGrad: 0 };
  let acc = 0;
  let p99 = 0;
  const target = Math.max(1, inner * 0.99);
  for (let b = 0; b < 64; b++) {
    acc += hist[b];
    if (acc >= target) {
      p99 = b * 4;
      break;
    }
  }
  return { detail: strong / n, darkFrac: dark / n, bright: sum / n / 255, sharpGrad: inner ? p99 : 0 };
}

/**
 * Strength of a concentric edge inside the blob. A front view always shows the
 * crystal / chapter ring as a sharp circle inside the case; an engraved case
 * back only has faint text rings.
 */
function ringStrength(lum, cx, cy, r) {
  const at = (x, y) => (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ? -1 : lum[Math.round(y) * W + Math.round(x)]);
  let best = 0;
  for (let t = 0.45; t <= 0.86; t += 0.05) {
    const rr = r * t;
    let acc = 0;
    let n = 0;
    for (let a = 0; a < 64; a++) {
      const th = (a / 64) * Math.PI * 2;
      const ux = Math.cos(th);
      const uy = Math.sin(th);
      const inner = at(cx + ux * (rr - 2.5), cy + uy * (rr - 2.5));
      const outer = at(cx + ux * (rr + 2.5), cy + uy * (rr + 2.5));
      if (inner < 0 || outer < 0) continue;
      acc += Math.abs(outer - inner);
      n++;
    }
    if (n) best = Math.max(best, acc / n);
  }
  return best / 255;
}

/**
 * Hour-marker periodicity. A dial carries 12 evenly spaced indices (or 3/6/9/12
 * numerals) around the chapter ring, so the contrast signal sampled along an
 * annulus has a strong 12-fold component. An engraved case back - which is the
 * photo that fools every "is this detailed?" test, because "STAINLESS STEEL
 * WATER RESISTANT" is busier than hands - has text, not spacing, and scores low.
 * Also returns how much of the disc is skin, which marks a model/wrist shot.
 */
function dialHarmonics(lum, cx, cy, r) {
  const at = (x, y) => (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ? -1 : lum[Math.round(y) * W + Math.round(x)]);
  let twelve = 0;
  let total = 0;
  for (let t = 0.55; t <= 0.8; t += 0.05) {
    const rr = r * t;
    const sig = [];
    for (let a = 0; a < 120; a++) {
      const th = (a / 120) * Math.PI * 2;
      const v = at(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr);
      sig.push(v < 0 ? 0 : v);
    }
    const mean = sig.reduce((s, v) => s + v, 0) / sig.length;
    const dev = sig.map((v) => Math.abs(v - mean));
    const sum = dev.reduce((s, v) => s + v, 0);
    if (!sum) continue;
    // 12-fold Fourier amplitude, normalised by the signal's own energy.
    let re = 0;
    let im = 0;
    for (let a = 0; a < 120; a++) {
      const th = (a / 120) * Math.PI * 2;
      re += dev[a] * Math.cos(12 * th);
      im += dev[a] * Math.sin(12 * th);
    }
    const amp = Math.hypot(re, im) * 2 / 120;
    twelve = Math.max(twelve, amp / (sum / 120));
    total = Math.max(total, mean);
  }
  return { twelve: +twelve.toFixed(3), total };
}

/**
 * Shape of the case head itself, which is what tells a straight-on dial from one
 * tipped away from the camera. Walking out from the centre of the case along 72
 * rays and stopping at the first hard edge gives a radius per angle:
 *
 *   face square to the lens   every ray stops on the case edge -> round profile
 *   face tipped away          only the left/right rays reach an edge soon, the
 *                             rest run up and down the strap -> the inscribed
 *                             circle is no longer the case, so few rays find an
 *                             edge near it and those that do form a thin ellipse
 *
 * `coverage` is the share of directions that hit a case edge within 1.3 radii of
 * the centre; `flat` is the 2-fold (elliptical) component of the radii that did.
 * A square case tipped straight-on scores flat ~= 0 too, because its corners are
 * a 4-fold pattern (`four`), so square DKNY and Michael Kors cases are not
 * mistaken for profiles.
 */
export function caseProfile(lum, cx, cy, r) {
  const at = (x, y) => (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ? -1 : lum[Math.round(y) * W + Math.round(x)]);
  const N = 72;
  const lo = 0.35 * r;
  const hi = 1.3 * r;
  const edge = new Uint8Array(N);
  const rho = new Float64Array(N);
  for (let a = 0; a < N; a++) {
    const th = (a / N) * Math.PI * 2;
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    let bestG = 0;
    let bestR = 0;
    for (let rr = lo; rr <= hi; rr += 1.5) {
      const g = Math.abs(at(cx + ux * (rr + 2.5), cy + uy * (rr + 2.5)) - at(cx + ux * (rr - 2.5), cy + uy * (rr - 2.5)));
      if (g > bestG) {
        bestG = g;
        bestR = rr;
      }
    }
    edge[a] = bestG >= 16 ? 1 : 0;
    // A ray that finds no case edge inside 1.3 radii is censored at that limit:
    // the case simply does not extend that far in that direction, which is the
    // whole point of the measurement. Dropping those rays would hide a profile.
    rho[a] = edge[a] ? bestR : hi;
  }
  let hits = 0;
  for (let a = 0; a < N; a++) hits += edge[a];
  const coverage = hits / N;
  const mean = rho.reduce((s, v) => s + v, 0) / N;
  if (!mean) return { coverage: 0, flat: 1, four: 0 };
  let re2 = 0;
  let im2 = 0;
  let re4 = 0;
  let im4 = 0;
  for (let a = 0; a < N; a++) {
    const th = (a / N) * Math.PI * 2;
    const d = rho[a] - mean;
    re2 += d * Math.cos(2 * th);
    im2 += d * Math.sin(2 * th);
    re4 += d * Math.cos(4 * th);
    im4 += d * Math.sin(4 * th);
  }
  // Fourier amplitude of the deviation, relative to the case's own size.
  const scale = 2 / (N * mean);
  return {
    coverage: +coverage.toFixed(3),
    flat: +Math.min(2, Math.hypot(re2, im2) * scale).toFixed(3),
    four: +Math.min(2, Math.hypot(re4, im4) * scale).toFixed(3),
  };
}

/**
 * The largest connected skin-toned region, and how textured it is. A model or a
 * wrist is a big skin area that reaches the edge of the frame and has detail
 * inside it (fingers, knuckles, jewellery); a beige studio backdrop is one huge
 * skin-toned area that is perfectly smooth, and a tan leather strap is small.
 */
function skinBlob(canvas) {
  const { data, info } = canvas;
  const w = info.width;
  const h = info.height;
  const n = w * h;
  const lum = luma(canvas);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    const R = data[o];
    const G = data[o + 1];
    const B = data[o + 2];
    if (R < 70 || G < 35 || B < 20 || R < G || R < B) continue;
    const cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
    const cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
    if (lum[i] > 60 && cb >= 77 && cb <= 130 && cr >= 133 && cr <= 173) mask[i] = 1;
  }
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best = { frac: 0, edge: false, texture: 0 };
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let area = 0;
    let edge = false;
    let strong = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1 && Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + w] - lum[p - w]) > 26)
        strong++;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
    }
    if (area > best.frac * n) best = { frac: area / n, edge, texture: area ? strong / area : 0 };
  }
  return best;
}

export function classifyCanvas(canvas, opts = {}) {
  const { width: w, height: h } = canvas.info;
  const lum = luma(canvas);
  const mask = watchMask(lum, w, h);
  const main = mainComponent(mask, w, h);
  if (!main) return { front: false, reason: "empty", frontScore: 0, radius: 0, detail: 0, darkFrac: 0, ring: 0 };

  const D = distanceToEdge(main.own, w, h);
  let best = 0;
  let at = 0;
  for (let i = 0; i < w * h; i++)
    if (D[i] > best) {
      best = D[i];
      at = i;
    }
  const radius = best / 3.5; // chamfer units -> px
  const cx = at % w;
  const cy = (at - cx) / w;

  const { detail, darkFrac, bright, sharpGrad } = discStats(lum, cx, cy, radius);
  const ring = ringStrength(lum, cx, cy, radius);
  const clean = cleanScore(canvas);
  const { twelve } = dialHarmonics(lum, cx, cy, radius);
  const face = caseProfile(lum, cx, cy, radius);
  const skin = skinBlob(canvas);

  // Size: a case that faces the lens is the widest thing in the frame, so the disc
  // spans most of the silhouette's width - and it must be big in absolute terms too,
  // or the "watch" is a dot in a lifestyle shot. The absolute part alone rejected
  // small-case women's watches (a Sonata with a 26 mm case is only ~85 px wide on a
  // 1000 px tile), which left their cards showing the coiled strap photo that passed
  // by being a bigger blob.
  const size = Math.min(1, radius / 95);
  const caseFrac = +(radius / Math.max(1, main.maxX - main.minX + 1)).toFixed(3);
  // Content: dial features (indices/hands/printing, the crystal ring) vs a plain
  // brushed flank or a promo card. Kept as a score, not a hard gate: a minimalist
  // sunray dial has almost nothing on it and is still a front view, so the gate
  // only needs to reject things that cannot be a front view at all.
  // A dark-pixel term is used sparingly on purpose: a white dial on a white
  // background is as bright as a polished case back, and weighing darkness heavily
  // is what let the back of MK4971 outscore its pavé dial.
  const content =
    Math.min(1, detail / 0.35) * 0.5 + Math.min(1, darkFrac / 0.25) * 0.15 + Math.min(1, ring / 0.1) * 0.35;
  const dialness = +(0.85 + 0.15 * Math.min(1, ring / 0.12)).toFixed(3);
  // Dial vs engraved case back, decided by what only a dial has, in the order
  // those signals prove reliable on the retailers' own front/back labelled
  // galleries: evenly spaced hour markers (12-fold regularity of the disc),
  // busyness (hands, sub-dials, applied indices are hard edges; polished steel
  // is smooth), then dark areas (a printed track or a coloured face).
  // Measured: MK4971 dial 0.23/0.648 vs its back 0.284/0.192; Maxima dial
  // 0.816/0.126 vs its back 0.211/0.144.
  const dialSignal =
    0.5 * Math.min(1, twelve / 0.45) + 0.3 * Math.min(1, detail / 0.35) + 0.3 * Math.min(1, darkFrac / 0.2);
  // The dial signals decide the ranking inside a gallery, so they are given the
  // widest swing of any term: 0.7x for a bare disc up to 1.4x for a marked one.
  const frontScore = +(size * content * dialness * (0.7 + 0.7 * dialSignal)).toFixed(3);

  // Extra things in the frame: a second sizeable blob next to the watch is a
  // spare strap, a gift box or a packaging card - the customer wants the watch
  // alone. Counted on the non-white silhouette, ignoring specks and shadows.
  const nObjects = (() => {
    const m = watchMask(lum, w, h, 250);
    const labels = new Int32Array(w * h).fill(-1);
    const stack = new Int32Array(w * h);
    let big = 0;
    let id = 0;
    for (let i = 0; i < w * h; i++) {
      if (!m[i] || labels[i] >= 0) continue;
      let sp = 0;
      stack[sp++] = i;
      labels[i] = id;
      let area = 0;
      while (sp) {
        const p = stack[--sp];
        const x = p % w;
        const y = (p - x) / w;
        area++;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (m[q] && labels[q] < 0) {
              labels[q] = id;
              stack[sp++] = q;
            }
          }
      }
      if (area > w * h * 0.04) big++;
      id++;
    }
    return big;
  })();

  const areaFrac = main.area / (w * h);
  const bw = main.maxX - main.minX + 1;
  const bh = main.maxY - main.minY + 1;
  // A person in the frame. Measured on this catalogue, colour alone is useless:
  // gold and rose-gold cases and mesh bracelets read as skin to the same degree a
  // forearm does (the 14 most skin-coloured frames in the shop are 14 gold watches,
  // not one person), and a pale dial on white gives the weak crystal ring that used
  // to complete the test. So the rule now needs the region to actually be smooth
  // skin, or the silhouette to be a body filling the frame.
  const modelRisk =
    (skin.frac > 0.35 && skin.texture < 0.12 && ring < 0.05 && detail < 0.12) || // bare forearm, no case
    areaFrac > 0.66; // a model shot from the shoulders up
  // The frame retailers use for a case back: coil the strap into a loop and lay the
  // clasp over the case. The silhouette then fills the frame AND is round, while a
  // watch lying straight on the lens is a tall narrow shape (measured: clean dials
  // areaFrac 0.24-0.42 with w/h 0.35-0.68; coiled straps 0.53-0.61 with w/h 0.72-1.4).
  // Dial evidence clears the suspicion: a coiled strap shows a polished clasp with
  // neither an inked face (clasps stay under darkFrac 0.2) nor hour-marker symmetry
  // (twelve tops out ~0.26), while a fat chronograph case photographed straight on -
  // wide case, short strap stubs - hits both shape tests with a dozen indices on it.
  const coiled =
    !(twelve >= 0.28 || darkFrac >= 0.2) && areaFrac >= 0.5 && bw / bh >= 0.75;
  const cluttered = nObjects > 1;
  // A watch facing the camera always shows a circular case edge / crystal ring.
  // Measured across the catalogue: real dials 0.055+, wrists, case-back flats and
  // printed cards 0.03-. Without this, a hand holding a watch scores as a dial.
  // A watch seen straight-on presents a closed case outline all the way round
  // the disc; tipped onto its side, the outline runs away up and down the strap
  // and only the left and right directions still find an edge. Measured: every
  // straight-on frame - round, oval and square cases alike - scores coverage 1.0,
  // DKNY's foreshortened ones 0.83-0.89.
  // A watch facing the camera shows a circular case edge / crystal ring. The floor
  // is low because a pale gold dial on a white background has almost no contrast at
  // its edge (measured 0.032-0.045 on Titan and Fastrack gold watches, which the old
  // 0.045 floor rejected as "no crystal ring"); what separates those from a printed
  // card or a wrist is the dial evidence in isClear() and the frame tests above.
  const bigEnough = radius >= 92 || (radius >= 60 && ring >= 0.09);
  const ringOk = ring >= 0.028;
  // The watch has to dominate the frame. A marketing card - brand name, a
  // paragraph, a small watch beside it - measures cleanly on every circular test
  // while being 8% of the picture; a product photo, once trimmed, always spans it.
  const span = +(Math.max(bw, bh) / H).toFixed(3);
  const front =
    bigEnough &&
    ringOk &&
    span >= 0.6 &&
    content >= 0.12 &&
    !modelRisk &&
    !coiled &&
    !cluttered &&
    face.coverage >= 0.93;
  const reason = front
    ? ""
    : face.coverage < 0.93
      ? "edge-on"
      : coiled
        ? "coiled-strap"
        : span < 0.6
          ? "small-in-frame"
          : !bigEnough
          ? "thin-band"
          : modelRisk
            ? "model-shot"
            : cluttered
              ? "extras-in-frame"
              : !ringOk
                ? "no-crystal-ring"
                : "no-dial";

  return {
    front,
    frontScore,
    reason,
    clean: +clean.toFixed(3),
    radius: Math.round(radius),
    detail: +detail.toFixed(3),
    darkFrac: +darkFrac.toFixed(3),
    ring: +ring.toFixed(3),
    dialContrast: sharpGrad,
    twelve: +twelve.toFixed(3),
    coverage: face.coverage,
    flat: face.flat,
    four: face.four,
    caseFrac,
    span,
    coiled,
    skinFrac: +skin.frac.toFixed(3),
    skinEdge: skin.edge,
    skinTex: +skin.texture.toFixed(3),
    objects: nObjects,
    dialness,
    modelRisk,
    cluttered,
    areaFrac: +areaFrac.toFixed(3),
    bright: +bright.toFixed(3),
    content: +content.toFixed(3),
    rRatio: +(radius / (H / 2)).toFixed(3),
    bbox: { w: bw, h: bh, aspect: +(bw / bh).toFixed(2) },
    area: main.area,
    cx,
    cy,
  };
}

/**
 * Cleanliness of a photo as a catalogue image (ported from the clarity pass):
 * product centred on white scores high, lifestyle crops, dark boxes, promo
 * cards and text bars score low. Used only to break ties between two
 * front-facing candidates.
 */
export function cleanScore(canvas) {
  const { data, info } = canvas;
  const w = info.width;
  const h = info.height;
  const n = w * h;
  const lum = luma(canvas);
  let dark = 0;
  let white = 0;
  for (let i = 0; i < n; i++) {
    if (lum[i] < 80) dark++;
    if (lum[i] >= 244) white++;
  }
  let edgeDirty = 0;
  let edgeN = 0;
  const R = 12;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x < R || y < R || x >= w - R || y >= h - R) {
        edgeN++;
        if (lum[y * w + x] < 244) edgeDirty++;
      }
    }
  const mask = watchMask(lum, w, h, 250);
  const main = mainComponent(mask, w, h);
  const fill = main ? main.area / n : 0;
  const wide = main ? (main.maxX - main.minX + 1) / (main.maxY - main.minY + 1) : 1;
  return (
    (white / n) * 1.0 -
    (dark / n) * 2.5 -
    (edgeN ? edgeDirty / edgeN : 0) * 4 +
    Math.max(0, fill - 0.08) * 0.4 -
    Math.max(0, wide - 3) * 0.35 -
    Math.max(0, 3 - wide) * 0.12
  );
}

/** Couple/set SKUs are photographed as a pair, and that is the correct photo.
 *  ("GIFT" is deliberately absent: a gift-pack tin is exactly what the customer
 *  does not want to see instead of the watch.) */
export function isSet(w) {
  return /SET|DUO|PAIR|COMBO|TWIN/i.test(`${w.model || ""} ${w.fn || ""} ${w.id || ""}`);
}

/** True when a frame may show more than one watch: a set product. */
export function allowsMultipleObjects(w) {
  return isSet(w);
}

/**
 * The geometric gate, as a function of a measured frame, so the audit, the gallery
 * repair and the web sourcing all apply one rule instead of retyping it - the
 * retyped copies drifted apart twice and each time a class of bad frame slipped
 * through the difference. `allowMultiple` is for couple/set SKUs, where two watches
 * in the frame is the correct photo.
 */
export function gateOk(r, { allowMultiple = false } = {}) {
  const sizeOk = r.radius >= 92 || (r.radius >= 60 && r.ring >= 0.09);
  // A strap coiled into a loop with the clasp over the case back: the silhouette
  // fills the frame and is round, which a watch lying straight on the lens is not.
  // Dial evidence on the disc (see classifyCanvas) clears the suspicion - a clasp
  // has neither an inked face nor twelve-fold marker symmetry.
  const coiled =
    !(r.twelve >= 0.28 || r.darkFrac >= 0.2) &&
    r.areaFrac >= 0.5 &&
    (r.bbox ? r.bbox.aspect >= 0.75 : false);
  return Boolean(
    sizeOk &&
      r.span >= 0.6 &&
      r.content >= 0.12 &&
      r.ring >= 0.028 &&
      r.coverage >= 0.93 &&
      !coiled &&
      !r.modelRisk &&
      (allowMultiple || !r.cluttered),
  );
}

/**
 * Beyond the geometric gate: does the frame really show a dial? A polished case
 * back or a bracelet clasp satisfies the gate - its edges give a ring, its
 * engravings give detail - so a photo is only storefront-usable when it also
 * carries dial evidence: hour markers in a circle, hard edges (hands, applied
 * indices, sub-dials) or a dark face. Measured on the frames that were complained
 * about: MK4971's back twelve 0.284 / detail 0.192 against its pavé dial at 0.23 /
 * 0.648, DKNY's clasp at 0.251 / 0.258, straight-on dials across the catalogue
 * 0.24-0.85 on one of the three. Callers OR this with their own set exception,
 * where two watches in one frame is the correct photo.
 */
export function isClear(r, { allowMultiple = false } = {}) {
  // allowMultiple mirrors gateOk's option. A couple SKU is photographed as a pair,
  // which makes the single-object test (r.front) false on the correct frame; the
  // dial evidence below is what actually says "this is a face, not a case back", and
  // it reads the biggest disc in the frame either way.
  const shapeOk = allowMultiple ? gateOk(r, { allowMultiple: true }) : r.front;
  return Boolean(shapeOk) && (r.twelve >= 0.28 || r.detail >= 0.28 || r.darkFrac >= 0.15);
}

export async function classifyImage(input, opts = {}) {
  return classifyCanvas(await scoringCanvas(input), opts);
}

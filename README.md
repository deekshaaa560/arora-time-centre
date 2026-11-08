# Arora Time Centre — Watch Store Website

A branded-watches storefront for an Indian store carrying 20 brands
(Titan, Fastrack, Casio, G-Shock, Fossil, Citizen, Michael Kors, Emporio
Armani and more).

**Flow:** browse → click a watch → Add to Cart → Checkout opens WhatsApp
with a pre-written order message → confirm availability on chat or call.
There is no online payment and no order form.

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`)
- GSAP + ScrollTrigger (scroll animations, hero scrub) — fully free since 3.13
- Three.js via @react-three/fiber + drei (scroll-rotating 3D chronograph hero)
- LottieFiles dotLottie accents
- react-router-dom (Home / About / Collection / Men's / Women's / Contact)

## Run

```bash
npm install
npm run dev      # http://localhost:5172 (check terminal for port)
npm run build    # type-check + production build into dist/
```

## Edit me first

1. **`src/config.ts`** — shop name, phone, WhatsApp, hours and address.
2. **`src/data/watches.ts`** — catalog exports + marketing brand list.
3. **`src/data/catalog.json`** — the live stock (2,053 Fastrack, Titan and
   Timex watches) generated from the distributor stock sheets. Product photos
   live in `public/products/`.

## Refreshing the catalog from new stock sheets

Drop the new sheet PDFs in place and re-run:

```bash
node scripts/extract-pdfs.mjs        # page text (update paths in the script)
node scripts/parse-sheets.mjs        # -> tmp/extract/products.json
node scripts/upscale-products.mjs    # Real-ESRGAN upscale + cutouts -> tmp/products-ai
node scripts/build-catalog.mjs       # -> src/data/catalog.json
```

The photo pipeline: source thumbnails from the PDFs are AI-upscaled 4× with a
local Real-ESRGAN ONNX model (`onnxruntime-node`), given a light unsharp pass,
composed onto 600×600 white tiles and background-removed via flood fill, so
each watch floats on the dark cards. Final assets are WebP (~25 KB each,
600×600, quality 90) — sharp on retina and light enough for mobile. Products on
pages whose image↔row alignment is unreliable keep a branded placeholder
instead of a wrong photo. The Fossil-group workbook images are official dealer
assets and go through the same tile/cutout treatment.

## Checkout

Checkout is WhatsApp-only. The cart builds a pre-written message with each
watch's name, code, quantity and price (plus a shareable photo link), then
opens `wa.me` in a new tab. The customer presses send and confirms stock,
price and payment with the shop directly. There is no payment gateway and no
order form.

## 3D model credit

Hero model: “Chronograph Watch” by Eric Chadwick / Darmstadt Graphics Group,
Khronos glTF Sample Assets, CC-BY-4.0 (linked in the footer).

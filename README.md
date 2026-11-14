# Arora Time Centre — Watch Store Website

A branded-watches storefront for an Indian store carrying 22 brands
(Titan, Fastrack, Casio, G-Shock, Fossil, Citizen, Michael Kors, Emporio
Armani, Bigotti Milano, Valentino Orlandi and more).

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

## Deploying

The site is a plain static build with client-side routes, so the host only
needs to do two things: serve `dist/` and rewrite every unknown path to
`index.html`. Otherwise a cold visitor opening a shared product link gets a
404 (the server has no `/collection` file — React makes that page).

Three configs ship for the hosts you are likely to point
`aroratimecentre.in` at; only the one you use matters, the rest are inert:

| Host | Config | Notes |
| --- | --- | --- |
| cPanel / Hostinger | `public/.htaccess` | copied into `dist/` by the build, upload `dist/*` to `public_html` |
| Netlify | `netlify.toml` | build `npm run build`, publish `dist` |
| Vercel | `vercel.json` | framework preset "Vite" |

**One canonical host.** Share links come from `SITE` in `src/config.ts`
(`https://aroratimecentre.in`), and the configs 301 `www.` to it, so every
customer receives the same bare-domain link. On Vercel/Netlify, add *both*
`aroratimecentre.in` and `www.aroratimecentre.in` to the project domains and
pick the bare domain as primary — HTTPS certificates for `www` are issued by
the host, not by the repo.

`vite.config.ts` deliberately has no `base`: the site is served from the
domain root. Only add `base: "/watch_website/"` (plus a matching `basename`
on `BrowserRouter` in `src/App.tsx`) if you ever host it on a *subpath*, e.g.
GitHub Pages project sites.

### What a share link looks like

`watchUrl()` (`src/lib/watchShare.ts`) prefixes `watchLink()`
(`src/data/watches.ts`) with the canonical origin, so the same watch is:

```text
http://localhost:5173/collection?brand=titan&code=rnu95219vm01   # dev
https://aroratimecentre.in/collection?brand=titan&code=rnu95219vm01  # live
```

`?brand=` filters the collection grid, `?code=` (the lowercased model number)
pops that watch's details open. On the live domain the WhatsApp enquiry also
gains a `Watch photo:` line pointing at
`https://aroratimecentre.in/products/<brand>-<code>.webp` — `watchImageUrl()`
suppresses it on localhost, where that URL would not resolve for anyone else.

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

### Richcrest brochures (Bigotti Milano, Valentino Orlandi)

The two Italian fashion labels arrive as 2026 catalogue PDFs (Richcrest Time):
every product page is a grid cell with one full-resolution front-view photo and
a printed label - MEN/WOMEN, MODEL NO., MRP. The import is three stages:

```bash
node scripts/brochure-import.mjs --extract  # pair each photo with its label -> tmp/brochures/<key>/
node scripts/brochure-tiles.mjs             # cut, float on white, upscale, gate -> public/products/
node scripts/brochure-merge.mjs             # append rows -> src/data/catalog-final.json
```

`brochure-import.mjs` reads placements off the render tree (a `Device` receives
every `fillImage` with its CTM) and model/price labels off the structured text,
in one shared y-down coordinate space, so each photo is matched to the label
beside it - 106 + 55 models, exactly the counts the brochures print. The brand
logos in `public/brand-logos/` are the vector marks rendered at 8x and
separated from the page.

`brochure-tiles.mjs` floods the studio background out. Colour does the work
brightness cannot: the brochure backgrounds are warm (cream / brown glow) and
the steel is neutral, and blowing polished chrome to white-level is exactly
what made the gate's flood walk through bracelet links into the case. The kept
mask therefore also seals a 6px band of watch pixels just under the gate's
white level on the final tile, which is what the storefront audit re-measures.

The photo pipeline: source thumbnails from the PDFs are AI-upscaled 4× with a
local Real-ESRGAN ONNX model (`onnxruntime-node`), given a light unsharp pass,
composed onto 600×600 white tiles and background-removed via flood fill, so
each watch floats on the dark cards. Final assets are WebP (~25 KB each,
600×600, quality 90) — sharp on retina and light enough for mobile. Products on
pages whose image↔row alignment is unreliable keep a branded placeholder
instead of a wrong photo. The Fossil-group workbook images are official dealer
assets and go through the same tile/cutout treatment.

### Front view only

Every storefront photo must show the dial facing the camera. A side profile, a
case back, a gift box or a model wearing the watch hides the thing the customer
is buying, so those frames are not allowed on a card - and a watch is never
dropped just because its photo is bad: the photo gets replaced instead.

Passing the geometric gate is not enough. Two classes of frame got through it and
into the storefront: a **case back or clasp** (a crystal bezel reads as a crystal
ring, engravings and repeated links read as detail - MK4971's back scored 0.776
against its own pavé dial at 0.674, and two DKNY clasps scored above 1.1), and an
**edge-on watch** (DKNY's oval cases photographed at 3/4, where the bracelet runs
away from the lens). So a storefront frame must be a **clear front**, which is one
function, `isClear()` in `scripts/front-view.mjs`, used by every pass:

1. the geometric gate, plus `coverage >= 0.93` - walking out from the centre of the
   case in 72 directions must find the case edge in all of them. A watch square on
   the lens always does (measured: 1.0 on every straight-on frame in the catalogue,
   round, oval and square cases alike); a tipped one only has edges left and right,
   and scores 0.83-0.89. This is what rejects a profile without penalising a square
   case, whose corners are a 4-fold pattern, not a 2-fold one.
2. dial evidence: `twelve >= 0.28 || detail >= 0.28 || darkFrac >= 0.15` - markers,
   hard edges, or a dark face. A polished back has none.
3. no person, nothing else in frame - unless the product is a couple/set SKU, where
   two watches in one photo is the correct photo.

The retailer's own view **label outranks the measurement**: a photo whose Myntra
label says `back`, `left`, `right`, `top`, `bottom` or `certificate` is never the
hero, however well it scores, and is replaced from the same gallery. Two DKNY
clasps scored 1.10 and 1.11 - above most real dials - while Myntra called them
`back`.

Where a listing carries no labels at all (Michael Kors, Armani Exchange, Emporio
Armani, Fossil, Guess, Tommy Hilfiger), the **frame the retailer puts first** wins,
as long as it survives the same checks: a shop sells the watch with the dial facing
the customer, and that prior fixed 203 Michael Kors / Sonata / DKNY cards in one
pass, including 27 where the hero scored *lower* than the coiled case back it
replaced. A frame that passes every test at a small size is still rejected
(`span >= 0.6`): a marketing card with the brand name, a paragraph and a thumbnail
watch is 8% of the picture. And a small case is not a profile: a 26 mm women's dial
is only ~85 px across on a 1000 px tile, so the size floor is `radius >= 92` or
`radius >= 60` with a strong crystal ring - before that, Sonata's tiny dials lost
their cards to the coiled strap photo that measured bigger.

Two more rules came out of the Michael Kors complaints, both from measuring the
wrong calls rather than from looking at pictures:

- **Skin colour is not a person.** `skin.frac > 0.15` rejected gold and rose-gold
  watches wholesale - the 14 most skin-coloured frames in the shop turned out to be
  14 gold watches and not one person, and the rule was quietly blocking their real
  dials from being picked at all. A person now needs a large *smooth* region or a
  silhouette that fills the frame.
- **A coiled strap has a shape.** `areaFrac >= 0.5` with a roughly round silhouette
  is the loop retailers use to photograph a case back; a watch lying straight on the
  lens is a tall narrow shape (clean dials measured 0.24-0.42 with w/h 0.35-0.68,
  coils 0.53-0.64 with w/h 0.75-1.4).
- A pale dial on a white background has almost no crystal-ring contrast (0.03), so
  the ring floor came down to 0.028 and the dial-evidence test carries the weight.

When the measurement is still not enough, a person can decide instead:

```bash
node scripts/source-front-online.mjs --ids-file=tmp/mk-eyes.txt --sheet   # one strip per watch
node scripts/source-front-online.mjs --picks-file=tmp/picks.txt           # install "id index" lines
```

`--sheet` writes `tmp/webpick-<id>.png`: the frame in use, then every candidate the
web offered, numbered in the order `--picks-file` uses and captioned with the
detector's verdict. Michael Kors clasps, marketing cards and folded-bracelet shots
were chosen this way; `run-final3.ps1` re-applies the picks after the automated
passes, because the automated passes judge by measurement and the eye wins.

`scripts/pick-front.mjs` does the same for a row's *own* supplier gallery, which is the
better photo whenever one exists (`--picks-file=tmp/picks-local.txt`, lines of
`<id> <n>` where `n` is the `#n` printed on that row's sheet). Twelve Michael Kors
women's cards were settled after reading every one of the 144 by eye: engraved
case backs (MK4957, MK4981, MKO1216, MK7601, the MK7655/7659 sets), three watches
photographed on their side (MK7535, MK7537, MK7540), a wrist shot (MK7611), a
promotional graphic with the watch floating in printed copy (MK7472) and a tilted
glamour shot (MK7613) - all of which the geometry calls a clean front view, because a
case back is as round as a dial.

Two rules in `front-view.mjs` came out of that review. `isSet()` decides whether two
objects in one frame is clutter or the correct photo: a couple SKU (Fossil BQ2400SET,
the MK gift sets) is *sold* as a pair, and refusing its photo asked for a re-shoot of
something that cannot exist. So `gateOk()` and `isClear()` both take
`{ allowMultiple }` and every caller passes it from `isSet(w)`; the homepage checker
does the same, since a gift box on the first strip is exactly what the rule was written
against and a his-and-hers pair is not.

All of this lives in one exported predicate, `gateOk()` / `isClear()` in
`scripts/front-view.mjs`; the audit, the gallery repair and the web sourcing all
call it instead of retyping the thresholds, because retyped copies drifted apart
twice and each drift let a class of bad frame survive re-runs.

Both take `{ allowMultiple }` for set SKUs, and the audit marks a `picked` frame
`human: true` so `list-unclear.mjs` leaves it out of the target list and
`fix-front-views.mjs` / `source-front-online.mjs` skip it unless it is named with
`--ids`, asked for with `--sheet`, or forced with `--revisit-picked`. Without that,
every re-run re-decided the dozen frames a person had already chosen by eye - and
lost, because the measurement that failed on them is the measurement being fixed.

```bash
node scripts/audit-front-view.mjs --all          # who is not front-facing
node scripts/audit-front-view.mjs --brands=sonata --sheet=56   # labelled contact sheet
node scripts/list-unclear.mjs                    # -> tmp/still-bad.txt
node scripts/fix-front-views.mjs --dry           # re-pick from retailer galleries
node scripts/fix-front-views.mjs --ids-file=tmp/still-bad.txt  # or just the failing rows
node scripts/pick-front.mjs --ids=michael-kors-mk4971 [--apply]  # eyeball a gallery first
node scripts/source-front-online.mjs --brands='titan,fastrack,timex'  # find one online
node scripts/check-featured.mjs                  # the 12 homepage tiles
node scripts/finalize-photos.mjs && npm run build
```

Every pass takes an id list (`--ids=`, `--ids-file=`) because the audit names the
rows that fail, and rescanning 1,200 galleries to fix eleven of them wastes an hour.

`pick-front.mjs` exists for frames the detector still misjudges (pavé, ice-blue
sunray): it renders every image the listing holds as a labelled contact sheet
so a human confirms the true dial, and `--apply` tiles and installs that pick.

`scripts/front-view.mjs` is the shared detector. It floods the border colour to
white so a pale dial stays part of the watch, takes the largest disc that fits
inside the silhouette (a case facing the lens is fat, a profile is a thin band),
and then judges what is inside that disc. Ranking inside one watch's gallery is
done by what only a dial has:

| signal | dial | case back / card / wrist |
| --- | --- | --- |
| `twelve` - 12-fold regularity of the disc (hour markers) | 0.45-0.85 | 0.05-0.25 |
| `detail` - hard edges (hands, sub-dials, applied indices) | 0.25-0.65 | 0.03-0.19 |
| `ring` - the crystal edge | 0.06-0.44 | 0.02-0.05 |
| `coverage` - directions that reach a case edge | 1.0 | 0.83-0.89 (profiles) |

Darkness is deliberately weighted low: a white dial on a white background is as
bright as polished steel, and ranking on it is what kept the case back of MK4971
on the homepage instead of its pavé dial. Everything - the frame on disk and every
candidate - is measured on the same 1000x1000 white tile the storefront shows,
because the catalogue holds both 1000px and 1200px tiles and a disc-radius gate is
meaningless if the two are judged at their own scale.

Myntra labels each gallery image with its view (`front`, `back`, `left`,
`certificate`), so anything labelled back / left / right / top / bottom /
certificate is dropped outright - but the `front` label itself is only a
tiebreaker, because coils and case backs get it too. The veto is one-way: a label
naming a non-front view is decisive, a `front` label is not. Labels are missing
altogether for Michael Kors, Armani Exchange, Emporio Armani, Fossil, Guess and
Tommy Hilfiger, and their hero image is often a 3/4 or back shot, which is why
the detector, not the label, carries those brands.

Any row whose own gallery cannot supply a clean front - Titan, Fastrack and Timex
have no labels and often no listing record at all, and delisted Myntra items have
neither - is re-sourced from the open web instead: `source-front-online.mjs`
searches Myntra's category pages, Shopify stores (`justintime.in`, Sonata's own
`titanworld.com`) and image search, which reaches brand CDNs and other retailers
(Michael Kors' scene7 server, watchstationindia, shiels, watchdepot, Amazon
listing media). Every hit is tiled to the storefront's own 1000x1000 white canvas
and kept only if it passes the same gate; the best surviving frame wins, and where
the record carries a price and gender, those are taken from it too. Nothing here is
Myntra-only.

Prices: a row at Rs 0 is a bug, not a deal. `scripts/reprice-placeholder-rows.mjs`
re-reads them from Myntra's `api/myntra/models/<id>/view` endpoint (which still
serves delisted items, though it 404s when throttled) and from Shopify stores'
own catalogues - `justintime.in` for Casio and Alba, Sonata's `titanworld.com` -
matching on the model code in the product title or tags, taking `compare_at_price`
as MRP and reading gender and the functional word out of the same title.
`finalize-photos.mjs` then drops whatever is still unpriced, and records it in
`tmp/unpriceable.txt`; `restore-dropped-rows.mjs` puts a dropped row back for one
retry - a watch is only lost for good once every source has been asked twice.

```bash
node scripts/reprice-placeholder-rows.mjs
node scripts/source-front-online.mjs --needs-sourcing   # rows still lacking price or photo
node scripts/restore-dropped-rows.mjs                   # undo finalize's drops, once each
```

Watches the shop decides not to sell - discontinued, or with no presentable frame
anywhere - go out with `scripts/remove-rows.mjs`, which archives the row to
`tmp/removed-rows.json`, deletes the photo once nothing else points at it, and adds
the id to `tmp/removed-rows.txt` so `restore-dropped-rows.mjs` never puts it back:

```bash
node scripts/remove-rows.mjs --ids=michael-kors-mk7615,michael-kors-mk7543 --drop-images
```

### Is the photo the right watch?

Matching a retailer page on the model code is weak evidence - the code can appear on a
page about a different watch. So `scripts/check-photo-colour.mjs` compares the colour
inside each disc against the dial colour on the shop's own spec sheet, for the rows
where that sheet says something (`--origin=bing` limits it to the web-sourced ones,
`--sheet` writes a montage of the hits):

```bash
node scripts/check-photo-colour.mjs --sheet
```

It found Michael Kors MK7602 - a rose-gold bangle - showing a green chronograph, and
Emporio Armani AR11748 showing a size chart with a coin and a credit card on it. Both
were fixed. Transparent tiles need care: alpha-zero pixels keep arbitrary RGB (green,
usually), so the sample composites on white and skips them, or every dial reads green
and the whole catalogue looks wrong.

Where the eye has already accepted a frame that measures thin - a pale rose or
mother-of-pearl dial with no dark ink on it - say so, or the next automated pass
re-sources it and is free to install a different watch:

```bash
node scripts/mark-picked.mjs --ids=michael-kors-mk4907,michael-kors-mk7536
```

### Cutting the watch out of a crowd

The largest remaining class of bad frame was not a wrong frame at all: a supplier
photographing a couple pack shoots it from behind, so the image contains two watches and
zero dials, and every candidate search for that model returns the same back-view pair.
`scripts/crop-front.mjs` labels the objects in the frame, cuts each one out with a
margin, re-tiles it and measures it, and installs the crop that passes as a solo product
shot - preferring a crop with hour markers over one that merely measures clean, because
a clasp across a polished case back measures beautifully and shows nothing:

```bash
node scripts/crop-front.mjs --ids-file=tmp/still-bad.txt --from-candidates [--dry]
```

`--from-candidates` lets it work from the frames `--sheet` gathered rather than only the
file in use, which is the whole point: the front view usually exists, it just exists
inside a crowded frame. This recovered 18 of the 20 rows tried (the Timex TW00PR series
and a Titan Raga bangle); the two that did not are a Fastrack back-to-school splash
graphic and one rectangular dial that measures just under the marker floor, both marked
by eye.

Because "weak" rows are heuristic misses far more often than real defects - 64 sampled by
eye, two wrong, both wrong for other reasons - the nightly chain builds its re-source
list with `list-unclear.mjs --front-only` and keeps the full list in
`tmp/still-bad-all.txt` for reference. Re-sourcing a correct pale dial to chase a score
is how the shop loses photos it should never have touched.

## Checkout

Checkout is WhatsApp-only. The cart builds a pre-written message with each
watch's name, code, quantity and price (plus a shareable photo link), then
opens `wa.me` in a new tab. The customer presses send and confirms stock,
price and payment with the shop directly. There is no payment gateway and no
order form.

## 3D model credit

Hero model: “Chronograph Watch” by Eric Chadwick / Darmstadt Graphics Group,
Khronos glTF Sample Assets, CC-BY-4.0 (linked in the footer).

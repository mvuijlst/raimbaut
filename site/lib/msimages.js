// Manuscript photographs → web images. Each source photo in manuscripts/ (one file per
// folio) is published twice under a clean slug — the source names carry spaces and
// "°" — as a thumbnail for the page and a full view for the lightbox (capped: some
// scans are 2–3 MB). Renditions are cached in site/.cache/ms/ (git-ignored; survives
// the _site wipe) and copied to /manuscrits/ by a passthrough in eleventy.config.js,
// which is why the config runs publishAll() in "eleventy.before": the cache must be
// filled before passthrough copy happens. _data/edition.js awaits the same (memoized)
// call for the image URLs and dimensions.
//
// Filename convention:
//   "ROMAN[+ROMAN…] - Ms. SIGLUM - f° FOLIO - source.jpg"
// (parts after the roman numerals optional). A folio that carries several chansons
// names them all, joined by "+".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Image from "@11ty/eleventy-img";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(SITE, "..", "manuscripts");
const CACHE = path.join(SITE, ".cache", "ms");

const THUMB_W = 600;    // figures are ≤ 17rem wide: enough for 2× screens
const FULL_W = 2200;    // lightbox zoom; never upscaled

export function parsePhotoName(file) {
  const base = file.replace(/\.[^.]+$/, "");
  const romans = ((base.match(/^([IVXL]+(?:\s*\+\s*[IVXL]+)*)(?![A-Za-z])/) || [])[1] || "")
    .split("+").map((r) => r.trim()).filter(Boolean);
  const siglum = (base.match(/Ms\.?\s*([A-Za-z]['’]?\d*)/) || [])[1] || null;
  const folio = ((base.match(/f[°o]\s*(\d+\s*(?:bis)?\s*[rv]?)/i) || [])[1] || "").replace(/\s+/g, "") || null;
  const source = (base.match(/(Vat\.?\s*lat\.?\s*\d+)/i) || [])[1] || null;
  // DigiVatLib's own downloads are named "<shelfmark>_<page index>_…": the index
  // addresses the folio in their viewer
  const digi = base.match(/Vat\.?\s*lat\.?\s*(\d+)_(\d{4})_/i) || [];
  const viewer = digi[2] ? `https://digi.vatlib.it/view/MSS_Vat.lat.${digi[1]}/${digi[2]}` : null;
  return { file, romans, siglum, folio, source, viewer };
}

async function publishPhoto(srcPath, slug) {
  const meta = await Image(srcPath, {
    widths: [THUMB_W, FULL_W],
    formats: ["jpeg"],
    outputDir: CACHE,
    urlPath: "/manuscrits/",
    sharpJpegOptions: { quality: 80, mozjpeg: true },
    filenameFormat: (id, src, width, format) => `${slug}-${width}.${format}`,
  });
  const sizes = meta.jpeg;                      // ascending; a small source yields one size
  const pick = (s) => ({ url: s.url, width: s.width, height: s.height });
  return { thumb: pick(sizes[0]), full: pick(sizes[sizes.length - 1]) };
}

let pending = null;
// → [{ file, romans, siglum, folio, source, viewer, photo: { thumb, full } }]
export function publishAll() {
  pending ??= (async () => {
    if (!fs.existsSync(SRC)) return [];
    const entries = [];
    const slugs = new Set();
    for (const file of fs.readdirSync(SRC).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f)).sort()) {
      const e = parsePhotoName(file);
      if (!e.romans.length) continue;
      const folio = e.folio ? e.folio.replace(/^(\d+)/, (n) => n.padStart(3, "0")) : e.romans.join("-");
      let slug = `${e.siglum || "ms"}-${folio}`.toLowerCase().replace(/[^a-z0-9-]+/g, "");
      while (slugs.has(slug)) slug += "x";
      slugs.add(slug);
      entries.push({ ...e, photo: await publishPhoto(path.join(SRC, file), slug) });
    }
    // drop cached renditions of photos that no longer exist, so they are not published
    const live = new Set(entries.flatMap((e) => [e.photo.thumb.url, e.photo.full.url]).map((u) => path.basename(u)));
    if (fs.existsSync(CACHE))
      for (const f of fs.readdirSync(CACHE)) if (!live.has(f)) fs.rmSync(path.join(CACHE, f));
    return entries;
  })();
  return pending;
}

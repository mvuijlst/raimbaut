"""
Extract every page of a PDF to the highest-resolution image possible.

Strategy
--------
The PDF (Adobe.pdf) is a scanned document: each page is a single embedded
JPEG. The *native* resolution of a scan is the embedded image itself --
rendering the page instead would only resample (and cannot add detail beyond
the source). So for pages backed by a single full-page image we pull the raw
embedded pixels directly (no interpolation, no quality loss).

Because the scans are stored rotated relative to how they display on the page,
we detect the correct orientation per page by comparing the four 90-degree
rotations of the extracted image against a small reference render of the page,
then keep the best match. A pure 90/180/270 rotation is a lossless pixel
rearrangement, so resolution is preserved exactly.

Pages that are NOT a single embedded image (vector content, multiple images,
etc.) fall back to rendering at a high DPI.

Output: PNG (lossless) files in ./pages/, one per page.
"""

import io
import sys
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
from PIL import Image

PDF_PATH = Path("Adobe.pdf")
OUT_DIR = Path("pages")
FALLBACK_DPI = 400          # used when a page isn't a single embedded image
REF_DPI = 36               # low-res reference render for orientation detection


def page_reference(page):
    """Grayscale render of the page in its true display ("reading") orientation."""
    pix = page.get_pixmap(dpi=REF_DPI, colorspace=fitz.csGRAY)
    return Image.frombytes("L", (pix.width, pix.height), pix.samples)


def to_portrait(img, portrait_only=True):
    """Enforce portrait output.

    A page whose reading orientation is landscape is a "rotated" page: per the
    export rule it must be turned to the LEFT (90 deg counter-clockwise) so the
    result is taller than it is wide. Returns (image, "left" | "none").
    """
    if portrait_only and img.width > img.height:
        return img.transpose(Image.ROTATE_90), "left"
    return img, "none"


def reading_orientation(img, page):
    """Rotate the stored image into the page's true display orientation.

    Anchors to PyMuPDF's own render (which honours the PDF placement matrix), so
    the choice is deterministic rather than a content guess. Only candidates
    whose aspect matches the render are considered, which cleanly resolves the
    upright-vs-upside-down (180 deg) ambiguity that a shape-blind compare cannot.
    """
    ref = page_reference(page)
    W, H = ref.size
    ref_portrait = H >= W
    ref_arr = np.asarray(ref, dtype=np.float32)

    candidates = {
        0: img,
        90: img.transpose(Image.ROTATE_90),
        180: img.transpose(Image.ROTATE_180),
        270: img.transpose(Image.ROTATE_270),
    }
    best = None
    for angle, cand in candidates.items():
        if (cand.height >= cand.width) != ref_portrait:
            continue  # aspect mismatch -> not the reading orientation
        cg = np.asarray(cand.convert("L").resize((W, H), Image.BILINEAR), dtype=np.float32)
        err = float(np.mean((cg - ref_arr) ** 2))
        if best is None or err < best[1]:
            best = (angle, err, cand)
    return best[2], best[0]


def extract_native(doc, page):
    """Return (portrait PIL image, note) from the single embedded image, or None."""
    imgs = page.get_images(full=True)
    if len(imgs) != 1:
        return None
    xref = imgs[0][0]
    info = doc.extract_image(xref)
    img = Image.open(io.BytesIO(info["image"]))
    img.load()
    reading, angle = reading_orientation(img, page)
    final, turned = to_portrait(reading)
    note = f"native {final.width}x{final.height}px (read@{angle}deg, turned {turned})"
    return final, note


def render_page(page, dpi):
    pix = page.get_pixmap(dpi=dpi)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    final, turned = to_portrait(img)
    note = f"rendered {final.width}x{final.height}px @ {dpi}dpi (turned {turned})"
    return final, note


def main():
    if not PDF_PATH.exists():
        sys.exit(f"Not found: {PDF_PATH}")
    OUT_DIR.mkdir(exist_ok=True)

    doc = fitz.open(PDF_PATH)
    n = doc.page_count
    width = len(str(n))
    print(f"{PDF_PATH}: {n} pages -> {OUT_DIR}/")

    for i, page in enumerate(doc):
        num = str(i + 1).zfill(width)
        out = OUT_DIR / f"page_{num}.png"

        result = extract_native(doc, page)
        if result is None:
            result = render_page(page, FALLBACK_DPI)
        img, note = result

        img.save(out)
        print(f"  [{num}/{n}] {out.name}  ({note})")

    doc.close()
    print("Done.")


if __name__ == "__main__":
    main()

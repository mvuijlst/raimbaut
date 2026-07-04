"""
OCR the printed page number from each vol1+vol2 PDF page (2026 source).

The text layer's page numbers are unreliable (digit-splitting, OCR swaps), so we
crop the top-right corner of each rendered page and ask a cheap vision model to
read it -- per the project's "vision-LLM over local OCR" preference. Output maps
the stable page id (v{vol}p{idx}) to the printed number, for citation anchors.

Output: page_numbers_v2.csv  (pageid, printed_number)  -- blank when NONE.
Requires OPENAI_API_KEY in .env. vol3 (annex) is excluded.
"""
import base64
import csv
import io
import re
from concurrent.futures import ThreadPoolExecutor

import fitz
from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image

PDFS = {1: "910001066311_2024_0001_AC.pdf", 2: "910001066313_2024_0001_AC.pdf"}
OUT_CSV = "page_numbers_v2.csv"
MODEL = "gpt-4o-mini"
WORKERS = 8
CROP_RIGHT_FRAC = 0.45
CROP_TOP_FRAC = 0.13
PROMPT = (
    "This is the top-right corner of a scanned book page. "
    "Reply with ONLY the printed page number (digits) you see, or NONE if none."
)

load_dotenv()
client = OpenAI()


def corner_b64(vol, idx):
    doc = fitz.open(PDFS[vol])
    try:
        p = doc[idx]; r = p.rect
        clip = fitz.Rect(r.x0 + r.width * (1 - CROP_RIGHT_FRAC), r.y0,
                         r.x1, r.y0 + r.height * CROP_TOP_FRAC)
        pix = p.get_pixmap(dpi=300, clip=clip, colorspace=fitz.csGRAY)
        img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    finally:
        doc.close()
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def read_number(page):
    vol, idx, pageid = page
    b64 = corner_b64(vol, idx)
    resp = client.chat.completions.create(
        model=MODEL, temperature=0,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]}],
    )
    answer = resp.choices[0].message.content or ""
    return pageid, "".join(re.findall(r"\d+", answer))


def main():
    pages = []
    for vol in sorted(PDFS):
        doc = fitz.open(PDFS[vol]); n = doc.page_count; doc.close()
        pages += [(vol, i, f"v{vol}p{i:03d}") for i in range(n)]
    print(f"Reading page numbers from {len(pages)} pages with {MODEL}...")
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(read_number, pages))
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(["pageid", "printed_number"])
        w.writerows(results)
    got = sum(1 for _, n in results if n)
    print(f"Wrote {len(results)} rows to {OUT_CSV} ({got} with a number, {len(results)-got} blank)")


if __name__ == "__main__":
    main()

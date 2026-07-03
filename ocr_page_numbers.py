"""
OCR the printed page number from the top-right corner of each scanned page.

Each file in ./pages/ is a portrait scan of a book page with its page number
printed in the top-right corner (e.g. page_018.png shows "15"). The scans are
faint typewriter print, which classic OCR (Tesseract) reads poorly, so we crop
just the corner and ask a cheap vision model (gpt-4o-mini) to read the number.

Output: page_numbers.csv with two columns -- the image filename and the page
number we read (blank if the model found none).

Requires OPENAI_API_KEY in a .env file (or the environment).
"""

import base64
import csv
import io
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image

PAGES_DIR = Path("pages")
OUT_CSV = Path("page_numbers.csv")
MODEL = "gpt-4o-mini"
WORKERS = 8  # concurrent API calls

# Crop the top-right corner where the page number sits: right 45% of the width,
# top 13% of the height. Generous enough to tolerate scan skew.
CROP_RIGHT_FRAC = 0.45
CROP_TOP_FRAC = 0.13

PROMPT = (
    "This is the top-right corner of a scanned book page. "
    "Reply with ONLY the printed page number (digits) you see, "
    "or NONE if there is no number."
)

load_dotenv()
client = OpenAI()


def corner_b64(path):
    """Return the top-right corner of the page as a base64-encoded PNG."""
    img = Image.open(path)
    w, h = img.size
    crop = img.crop((int(w * (1 - CROP_RIGHT_FRAC)), 0, w, int(h * CROP_TOP_FRAC)))
    crop = crop.convert("L")
    buf = io.BytesIO()
    crop.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def read_page_number(path):
    """Ask the vision model for the page number; return digits, or "" if none."""
    b64 = corner_b64(path)
    resp = client.chat.completions.create(
        model=MODEL,
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"},
                    },
                ],
            }
        ],
    )
    answer = resp.choices[0].message.content or ""
    digits = re.findall(r"\d+", answer)
    return "".join(digits)  # "" when the model replied NONE / no digits


def main():
    files = sorted(PAGES_DIR.glob("page_*.png"))
    if not files:
        raise SystemExit(f"No page_*.png files found in {PAGES_DIR}/")

    print(f"Reading page numbers from {len(files)} images with {MODEL}...")
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        numbers = list(pool.map(read_page_number, files))

    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["filename", "page_number"])
        for path, num in zip(files, numbers):
            writer.writerow([path.name, num])
            print(f"{path.name}: {num or '(none)'}")

    print(f"\nWrote {len(files)} rows to {OUT_CSV}")


if __name__ == "__main__":
    main()

"""Generate the desktop-launcher icon assets (ICO / ICNS) from the brand PNG.

Source of truth: frontend/public/resumeforge-icon.png (512x512 brand logo).
Outputs:
  branding/resumeforge.ico  -- Windows desktop shortcut icon (multi-size)
  branding/resumeforge.icns -- macOS bundle/Dock icon (multi-size)

Re-run after the brand logo changes: python scripts/generate_icons.py
Requires Pillow (already a backend dependency via the image pipeline).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "frontend" / "public" / "resumeforge-icon.png"
OUTPUT_DIR = REPO_ROOT / "branding"

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICNS_SIZES = [16, 32, 64, 128, 256, 512]


def main() -> None:
    image = Image.open(SOURCE)
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    ico_path = OUTPUT_DIR / "resumeforge.ico"
    image.save(
        ico_path,
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
    )
    print(f"Written: {ico_path}")

    icns_path = OUTPUT_DIR / "resumeforge.icns"
    image.save(
        icns_path,
        format="ICNS",
        append_images=[image.resize((size, size), Image.LANCZOS) for size in ICNS_SIZES],
    )
    print(f"Written: {icns_path}")


if __name__ == "__main__":
    main()

"""Build a workspace's mascot set (same sizes and proportions as DAR's /brand files).

Usage: python scripts/make-workspace-mascot.py <slug> <mascot.png>
The source should be a head on a transparent background. Output: brand/ws/<slug>/.
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"
CREAM = (241, 237, 223, 255)


def bbox_of(img):
    """Box of the drawing: non-transparent, and on opaque images not the background colour."""
    rgba = img.convert("RGBA")
    if rgba.getpixel((0, 0))[3] == 0:
        return rgba.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    bg = rgba.getpixel((0, 0))
    mask = Image.new("L", rgba.size, 0)
    px, mp = rgba.load(), mask.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            p = px[x, y]
            if abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > 40:
                mp[x, y] = 255
    return mask.getbbox()


def place(head, ref_name):
    """Draw `head` on a canvas like brand/<ref_name>: same size, background and head box."""
    ref = Image.open(BRAND / ref_name).convert("RGBA")
    box = bbox_of(ref)
    bw, bh = box[2] - box[0], box[3] - box[1]
    scale = min(bw / head.width, bh / head.height)
    size = (max(1, round(head.width * scale)), max(1, round(head.height * scale)))
    resized = head.resize(size, Image.LANCZOS)
    opaque = ref.getpixel((0, 0))[3] == 255
    canvas = Image.new("RGBA", ref.size, CREAM if opaque else (0, 0, 0, 0))
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    canvas.alpha_composite(resized, (round(cx - size[0] / 2), round(cy - size[1] / 2)))
    return canvas


def main():
    slug, source = sys.argv[1], Path(sys.argv[2])
    src = Image.open(source).convert("RGBA")
    head = src.crop(bbox_of(src))
    out = BRAND / "ws" / slug
    out.mkdir(parents=True, exist_ok=True)
    files = {
        "mascot-128.png": "dar-mascot-128.png",
        "mascot-256.png": "dar-mascot-256.png",
        "mascot-fab.png": "dar-mascot-fab.png",
        "favicon-64.png": "favicon-64.png",
        "apple-touch-icon.png": "apple-touch-icon.png",
        "icon-192.png": "icon-192.png",
        "icon-512.png": "icon-512.png",
        "icon-maskable-512.png": "icon-maskable-512.png",
        "splash-1179x2556.png": "splash-1179x2556.png",
        "splash-1206x2622.png": "splash-1206x2622.png",
        "splash-1290x2796.png": "splash-1290x2796.png",
    }
    for name, ref in files.items():
        img = place(head, ref)
        if img.getpixel((0, 0))[3] == 255:
            img = img.convert("RGB")
        img.save(out / name, optimize=True)
        print(name, img.size, (out / name).stat().st_size, "bytes")


if __name__ == "__main__":
    main()

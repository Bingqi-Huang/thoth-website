"""Posters, hover previews and the hero loop from the clean replay frames.

    python3 tools/make_previews.py

Poster: one 960 px frame at 40 % of the run. Preview: 6 s, every third frame from 40 % on (3x time-lapse, 20 fps).
Hero: a slow 2x time-lapse of the no-spare repair while the rover works at the units.
"""
import os
import subprocess
from pathlib import Path

from PIL import Image

from catalog import SCENARIOS

ROOT = Path(__file__).resolve().parent.parent
M = ROOT / "public" / "media"


def frames(d):
    return sorted(n for n in os.listdir(d) if n.endswith(".png"))


def clip(d, names, out, fps, width, crf):
    lst = out.with_suffix(".list")
    lst.write_text("".join(f"file '{d}/{n}'\n" for n in names))
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-r", str(fps), "-i", str(lst),
                    "-vf", f"scale={width}:-2:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", str(crf),
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out)], check=True)
    lst.unlink()


def main():
    for sub in ("posters", "preview"):
        (M / sub).mkdir(parents=True, exist_ok=True)
    for sc in SCENARIOS:
        for r in sc["runs"]:
            if r["system"] != "thoth" or not Path(r["replay"]).is_dir():
                continue
            rid = Path(r["dir"]).name
            names = frames(r["replay"])
            i = int(len(names) * 0.4)
            im = Image.open(f"{r['replay']}/{names[i]}").convert("RGB")
            im.thumbnail((960, 540))
            im.save(M / "posters" / f"{rid}.webp", "WEBP", quality=80)
            clip(r["replay"], names[i:i + 360:3], M / "preview" / f"{rid}.mp4", 20, 640, 27)
            print("preview", rid)
    d = "/mnt/SharedData/Research/Space_Robot_Harness/artifacts/figures/exp1b/video_1x/replay/ours_l4_pdu1_r1"
    names = frames(d)
    a = names.index("0000380.00.png")
    clip(d, names[a:a + 1200:2], M / "hero.mp4", 30, 1600, 25)
    im = Image.open(f"{d}/{names[a]}").convert("RGB")
    im.save(M / "hero.webp", "WEBP", quality=82)


if __name__ == "__main__":
    main()

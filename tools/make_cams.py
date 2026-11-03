"""The rover's own cameras for the console: front over wrist, one small video per run at 2 fps.

    python3 tools/make_cams.py

Each run records both cameras about once per simulated second (frames/front, frames/wrist, named by sim time).
They are stacked (480x720), resampled to a constant 2 fps on the sim clock and written to media_build/cams/<run>.mp4;
build_data.py records the first frame's sim time so the page keeps them on the same clock as the replay.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

from catalog import RUNS, SCENARIOS

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "media_build" / "video" / "cams"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    for sc in SCENARIOS:
        for r in sc["runs"]:
            rid = Path(r["dir"]).name
            d = Path(RUNS) / r["dir"] / "frames"
            names = sorted(os.listdir(d / "front"))
            wrist = sorted(os.listdir(d / "wrist"))
            wt = [float(n[:-4]) for n in wrist]
            times = [float(n[:-4]) for n in names]
            near = [wrist[min(range(len(wt)), key=lambda j: abs(wt[j] - t))] for t in times]
            meta[rid] = times[0]
            out = OUT / f"{rid}.mp4"
            if out.exists():
                continue
            with tempfile.TemporaryDirectory() as tmp:
                lines = []
                for i, n in enumerate(names):
                    im = Image.new("RGB", (480, 720))
                    im.paste(Image.open(d / "front" / n).convert("RGB").resize((480, 360)), (0, 0))
                    im.paste(Image.open(d / "wrist" / near[i]).convert("RGB").resize((480, 360)), (0, 360))
                    p = f"{tmp}/{i:06d}.jpg"
                    im.save(p, quality=92)
                    dur = (times[i + 1] - times[i]) if i + 1 < len(times) else 1.0
                    lines.append(f"file '{p}'\nduration {dur:.3f}\n")
                Path(f"{tmp}/list.txt").write_text("".join(lines) + f"file '{p}'\n")
                subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                                "-i", f"{tmp}/list.txt", "-vf", "fps=2", "-c:v", "libx264", "-preset", "slow", "-crf", "30",
                                "-g", "4", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out)], check=True)
            print("cams", rid, len(names), f"{out.stat().st_size / 1e6:.1f} MB", flush=True)
    json.dump(meta, open(OUT / "t0.json", "w"), indent=1)


if __name__ == "__main__":
    main()

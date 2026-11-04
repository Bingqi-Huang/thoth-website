"""Encode every catalogued run whose replay is complete: python3 tools/encode_all.py [hevc|av1]

A site replay is complete once render.log says `done <run>`; the exp1b Thoth replays already are.
Output: media_build/video/<run>.{hevc,av1}.mp4 (fps from the frame names' spacing).
"""
import os
import subprocess
import sys
from pathlib import Path

from catalog import SCENARIOS

ROOT = Path(__file__).resolve().parent.parent
B = ROOT / "media_build"
which = sys.argv[1] if len(sys.argv) > 1 else "both"
done_log = (B / "render.log").read_text() if (B / "render.log").exists() else ""
runs = [r for sc in SCENARIOS for r in sc["runs"]]
if os.environ.get("REVERSE"):
    runs.reverse()
for r in runs:
        rid = Path(r["dir"]).name
        if any((B / "video" / f"{rid}.{k}.part.mp4").exists() for k in ("av1", "hevc", "sd") if which in (k, "both")):
            continue
        if r["replay"].startswith(str(B)) and f" done {rid} " not in done_log:
            continue
        names = sorted(n for n in os.listdir(r["replay"]) if n.endswith(".png"))
        fps = round(1 / (float(names[1][:-4]) - float(names[0][:-4])))
        print("encode", rid, fps, flush=True)
        subprocess.run([str(ROOT / "tools/encode_run.sh"), r["replay"], str(B / "video" / rid), str(fps), which], check=True)

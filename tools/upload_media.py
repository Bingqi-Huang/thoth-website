"""Upload the finished replays and camera videos to the Hugging Face dataset the site streams from.

    python3 tools/upload_media.py

Only complete files (no *.part.mp4) go up; files already there with the same content are skipped by the hub.
"""
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent.parent
HfApi().upload_folder(folder_path=str(ROOT / "media_build" / "video"), path_in_repo="video",
                      repo_id="Bingqiii/thoth-media", repo_type="dataset",
                      allow_patterns=["*.av1.mp4", "*.hevc.mp4", "*.sd.mp4", "cams/*.mp4"], ignore_patterns=["*.part.mp4"])
print("uploaded")

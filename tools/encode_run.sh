#!/bin/bash
# Encode one run's clean replay frames (file names are sim time) for the site: AV1 (Chrome, Firefox, Edge) and HEVC
# (Safari, hardware-decoding Chrome). ~0.85 Mbps each at 1600x900; the page maps video time + first frame = sim time.
#   encode_run.sh <frames_dir> <out_stem> <fps> [av1|hevc]   (default both)
set -e
F=$1; O=$2; FPS=${3:-10}; W=${4:-both}
L=$(mktemp); ls "$F" | grep -E '\.png$' | sed "s#^#file '$F/#;s#\$#'#" > "$L"
if [ "$W" != av1 ] && [ ! -s "$O.hevc.mp4" ]; then
  ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -r $FPS -i "$L" -c:v hevc_nvenc -preset p7 -tune hq -rc vbr \
    -cq 31 -b:v 0 -maxrate 6M -bufsize 12M -g $((FPS * 15)) -bf 3 -spatial-aq 1 -temporal-aq 1 -pix_fmt yuv420p \
    -tag:v hvc1 -movflags +faststart "$O.hevc.part.mp4" && mv "$O.hevc.part.mp4" "$O.hevc.mp4"
fi
if [ "$W" != hevc ] && [ ! -s "$O.av1.mp4" ]; then
  nice -n 10 ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -r $FPS -i "$L" -c:v libaom-av1 -cpu-used 6 -row-mt 1 \
    -tiles 2x2 -crf 38 -b:v 0 -g $((FPS * 15)) -pix_fmt yuv420p -movflags +faststart "$O.av1.part.mp4" && mv "$O.av1.part.mp4" "$O.av1.mp4"
fi
rm -f "$L"

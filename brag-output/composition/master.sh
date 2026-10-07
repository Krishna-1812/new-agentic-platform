#!/bin/sh
# master.sh <outdir> <v1|v2> <poster time>: mux the render with its mix at -14 LUFS
# and bake the poster in as frame 0 (same frame count, so audio sync holds).
set -e
ffmpeg -loglevel error -y -ss "$3" -i "work/$2-video.mp4" -frames:v 1 -q:v 2 "$1/brag.jpg"
ffmpeg -loglevel error -y -i "work/$2-video.mp4" -i "$1/brag.jpg" -i "work/$2.wav" \
  -filter_complex "[1:v]format=yuv420p[p];[0:v][p]overlay=enable='eq(n,0)'[v];[2:a]loudnorm=I=-14:TP=-1.5:LRA=9[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$1/brag.mp4"

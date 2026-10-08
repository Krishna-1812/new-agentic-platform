#!/bin/bash
# macOS: double-click me to set up video-studio.
cd "$(dirname "$0")"
bash ./setup-video-studio.sh "$@"
echo
read -n 1 -s -r -p "Press any key to close"

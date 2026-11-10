#!/bin/bash
# Stop Spotlight indexing and Backblaze for a clean baseline.
# Undo with ./restore.sh (or reboot for Backblaze only).
set -x
sudo mdutil -a -i off
sudo launchctl bootout system/com.backblaze.bzserv
sudo pkill -f /Library/Backblaze.bzpkg/
launchctl bootout gui/$(id -u)/com.backblaze.bzbmenu

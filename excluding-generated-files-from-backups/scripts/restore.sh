#!/bin/bash
# Turn Spotlight, Time Machine and Backblaze back on.
# Spotlight and Time Machine stay off across reboots until this runs.
set -x
sudo mdutil -a -i on
sudo tmutil enable
sudo launchctl bootstrap system /Library/LaunchDaemons/com.backblaze.bzserv.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.backblaze.bzbmenu.plist

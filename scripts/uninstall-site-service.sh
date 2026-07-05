#!/usr/bin/env bash
# Remove the broken auto-restart service (Downloads folder blocks launchd on macOS).
PLIST="$HOME/Library/LaunchAgents/com.mabbott.mortgage-hub.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed auto-restart service."
echo "Use: ~/bin/start-mortgage-hub.sh  (run once in Terminal, leave Mac awake)"

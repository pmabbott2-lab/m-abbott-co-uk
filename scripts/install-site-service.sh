#!/usr/bin/env bash
# Install a macOS LaunchAgent that keeps Mortgage Hub online while you're logged in.

set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.mabbott.mortgage-hub.plist"

mkdir -p "$HOME/Library/LaunchAgents"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mabbott.mortgage-hub</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_DIR}/scripts/site-watch.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/m-abbott-site/launchd.out</string>
  <key>StandardErrorPath</key>
  <string>/tmp/m-abbott-site/launchd.err</string>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed and started keep-alive service."
echo "It restarts the site automatically if it drops (while you're logged in)."
echo "Logs: /tmp/m-abbott-site/watch.log"

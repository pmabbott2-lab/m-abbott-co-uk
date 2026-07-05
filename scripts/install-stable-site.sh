#!/usr/bin/env bash
# Install macOS keep-alive for Mortgage Hub (production + ngrok).
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.mabbott.mortgage-hub.plist"
BIN="$HOME/bin"

chmod +x "$BIN/mortgage-hub-stable.sh" "$BIN/mortgage-hub-watch.sh"

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
    <string>${BIN}/mortgage-hub-watch.sh</string>
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
  <string>${HOME}</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Stable site service installed."
echo "  Project:  ~/Projects/m-abbott-co-uk-main"
echo "  Public:   https://another-selector-ranged.ngrok-free.dev"
echo "  Logs:     /tmp/m-abbott-site/"
echo ""
echo "Commands (any time):"
echo "  ~/bin/mortgage-hub-stable.sh status"
echo "  ~/bin/mortgage-hub-stable.sh rebuild   # after code changes for live site"
echo "  ~/bin/mortgage-hub-stable.sh stop"

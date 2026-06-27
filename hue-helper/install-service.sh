#!/usr/bin/env bash
# Installs the D&D VTT Hue helper as a systemd service so it starts on boot and
# restarts if it crashes. Run it once on the Raspberry Pi (or any Linux box):
#
#     cd ~/dnd-vtt/hue-helper
#     ./install-service.sh
#
# It auto-detects the node path, this folder, and your username.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
USER_NAME="${SUDO_USER:-$USER}"
SERVICE_NAME="dnd-hue-helper"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ -z "$NODE" ]; then
  echo "Error: 'node' was not found in PATH. Install Node.js first, then re-run."
  exit 1
fi

echo "Installing systemd service:"
echo "  user:        $USER_NAME"
echo "  folder:      $DIR"
echo "  node:        $NODE"
echo

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=D&D VTT Philips Hue helper
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$DIR
ExecStart=$NODE $DIR/hue-helper.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

echo "Done. The helper now starts automatically on boot."
echo
echo "Useful commands:"
echo "  sudo systemctl status $SERVICE_NAME      # see if it's running"
echo "  journalctl -u $SERVICE_NAME -f           # watch its logs live"
echo "  sudo systemctl restart $SERVICE_NAME     # restart after changes"
echo "  sudo systemctl disable --now $SERVICE_NAME  # turn auto-start off"

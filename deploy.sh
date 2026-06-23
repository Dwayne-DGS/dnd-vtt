#!/usr/bin/env bash
# Deploy / update the app from a git checkout.
# First time on the server:
#   git clone <your-repo-url> /opt/dnd-vtt && cd /opt/dnd-vtt && bash deploy.sh
# To update later (after I give you new code):
#   cd /opt/dnd-vtt && git pull && bash deploy.sh
set -e
cd "$(dirname "$0")"

echo ">> Installing dependencies ..."
npm install --no-audit --no-fund

echo ">> Ensuring pm2 is installed ..."
npm list -g pm2 >/dev/null 2>&1 || npm install -g pm2

echo ">> (Re)starting the app ..."
pm2 restart dnd-vtt 2>/dev/null || pm2 start server.js --name dnd-vtt
pm2 save

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "============================================================"
echo "  D&D VTT updated & running!  Open:  http://$IP:3000"
echo "  Logs: pm2 logs dnd-vtt   |   Restart: pm2 restart dnd-vtt"
echo "============================================================"

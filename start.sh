#!/usr/bin/env bash

# WiFi Smart Remote Launcher
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Free port 3000 if in use
PID=$(lsof -t -i:3000 2>/dev/null)
if [ -n "$PID" ]; then
  kill -9 $PID 2>/dev/null
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$IP" ] && IP="localhost"

echo "=========================================================="
echo "    🚀 STARTING WIFI SMART REMOTE (PC & SMART TV)"
echo "    Crafted by Ayush Tripathi (Sitekraft.dev)"
echo "=========================================================="
echo ""
echo "📱 Local WiFi URL: http://${IP}:3000"
echo ""
echo "🛡️  FIREWALL (UFW) NOTICE:"
echo "   Agar phone par connect na ho, terminal me ye run karein:"
echo "   sudo ufw allow 3000/tcp"
echo ""
echo "=========================================================="

# Start server in production mode
node server.mjs

#!/usr/bin/env bash
# Put a new version live. Run as root on the server:   bash /home/sokoni/app/deploy/update.sh
set -euo pipefail
APP=/home/sokoni/app
echo "→ 1/5  saving a backup first";          bash "$APP/deploy/backup.sh"
echo "→ 2/5  fetching the new version";       su - sokoni -c "cd $APP && git fetch --prune && git pull --ff-only"
echo "→ 3/5  installing";                     su - sokoni -c "cd $APP && npm install --omit=dev --no-fund --no-audit"
echo "→ 4/5  checking your settings";         su - sokoni -c "cd $APP && SOKONI_ENV_FILE=/etc/sokoni/sokoni.env node tools/check-setup.js"
echo "→ 5/5  restarting";                     systemctl restart sokoni; sleep 4
systemctl is-active --quiet sokoni && curl -fsS http://127.0.0.1:3000/api/health >/dev/null && echo "✓ Sokoni is running and healthy" || { echo "✗ Sokoni did not come back — see:  journalctl -u sokoni -n 60 --no-pager"; exit 1; }

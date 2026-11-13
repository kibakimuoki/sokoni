#!/usr/bin/env bash
# One compressed copy of EVERYTHING Sokoni stores (orders, users, photos, documents, analytics). Run daily by cron; keeps 14 days.
# The settings file is deliberately NOT included (it holds your passwords): keep a copy of it in your password manager.
set -euo pipefail
DATA=/var/lib/sokoni; OUT=/var/backups/sokoni; DAY=$(date +%F)
mkdir -p "$OUT"; umask 077
tar -czf "$OUT/sokoni-$DAY.tar.gz.partial" -C "$(dirname "$DATA")" "$(basename "$DATA")"
mv "$OUT/sokoni-$DAY.tar.gz.partial" "$OUT/sokoni-$DAY.tar.gz"
ln -sfn "$OUT/sokoni-$DAY.tar.gz" "$OUT/latest.tar.gz"
find "$OUT" -maxdepth 1 -name 'sokoni-*.tar.gz' -mtime +14 -delete
echo "$(date -Is)  backup ok: $(du -h "$OUT/sokoni-$DAY.tar.gz" | cut -f1)"

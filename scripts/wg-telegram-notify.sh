#!/bin/bash
# wg-telegram-notify.sh — kirim notifikasi Telegram dengan dedup (anti-spam)
#
# Usage:
#   wg-telegram-notify.sh "MESSAGE" [DEDUP_KEY]
#
# Env:
#   TELEGRAM_BOT_TOKEN  (required)
#   TELEGRAM_CHAT_ID    (required)
#
# Notes:
# - DEDUP_KEY digunakan untuk menahan pesan yang sama agar tidak spam.
# - Window dedup default: 30 menit (DEDUP_WINDOW_SECONDS).

set -euo pipefail

MSG="${1:-}"
KEY="${2:-}"

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"
: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is required}"

DEDUP_WINDOW_SECONDS="${DEDUP_WINDOW_SECONDS:-1800}"
STATE_DIR="/var/lib/wg-health-check"
STATE_FILE="${STATE_DIR}/telegram-dedup.state"

mkdir -p "$STATE_DIR"
touch "$STATE_FILE"
chmod 600 "$STATE_FILE" 2>/dev/null || true

now=$(date +%s)

# Dedup check
if [[ -n "$KEY" ]]; then
  last=$(awk -v k="$KEY" '$1==k{print $2}' "$STATE_FILE" 2>/dev/null | tail -n 1 || true)
  if [[ -n "$last" ]]; then
    age=$(( now - last ))
    if [[ "$age" -lt "$DEDUP_WINDOW_SECONDS" ]]; then
      exit 0
    fi
  fi

  # update state (remove old key lines, append new)
  tmp=$(mktemp)
  awk -v k="$KEY" '$1!=k{print $0}' "$STATE_FILE" > "$tmp" || true
  echo "$KEY $now" >> "$tmp"
  cat "$tmp" > "$STATE_FILE"
  rm -f "$tmp"
fi

# Send message
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${MSG}" \
  -d "disable_web_page_preview=true" \
  >/dev/null

#!/bin/bash
# WireGuard CLIENT health check + auto-recovery + Telegram alert on problems
#
# Usage:
#   wg-health-check-telegram.sh [INTERFACE] [EXPECTED_EGRESS_IP]
#
# Env:
#   HS_MAX_AGE        (default 600)
#   CURL_TIMEOUT      (default 8)
#   RESTART_GRACE     (default 5)
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (required for sending alerts)
#
# Requires:
#   /usr/local/bin/wg-telegram-notify.sh

set -euo pipefail

WG_IFACE="${1:-wg0}"
EXPECTED_IP="${2:-}"

HS_MAX_AGE="${HS_MAX_AGE:-600}"
CURL_TIMEOUT="${CURL_TIMEOUT:-8}"
RESTART_GRACE="${RESTART_GRACE:-5}"

LOG="/var/log/wg-health-check.log"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# rotate (1MB)
if [[ -f "$LOG" ]]; then
  sz=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
  if [[ "$sz" -gt 1048576 ]]; then
    mv "$LOG" "${LOG}.old" 2>/dev/null || true
  fi
fi

FAIL=0
WARN=0
OUT=""
EGRESS=""
ROUTE=""
AGE="NA"

pass() { OUT+="  ✓ $*\n"; }
fail() { OUT+="  ✗ $*\n"; FAIL=1; }
warn() { OUT+="  ! $*\n"; WARN=1; }

hn=$(hostname)

# 1) Interface
if ip link show "$WG_IFACE" &>/dev/null; then
  pass "Interface $WG_IFACE aktif"
else
  fail "Interface $WG_IFACE TIDAK ada/aktif"
fi

# 2) Handshake
if [[ "$FAIL" -eq 0 ]]; then
  last_hs=$(wg show "$WG_IFACE" latest-handshakes 2>/dev/null | awk '{print $2}' | head -1 || true)
  now=$(date +%s)
  if [[ -n "$last_hs" && "$last_hs" -gt 0 ]]; then
    AGE=$(( now - last_hs ))
    if [[ "$AGE" -le "$HS_MAX_AGE" ]]; then
      pass "Handshake segar: ${AGE}s"
    else
      fail "Handshake terlalu lama: ${AGE}s (> ${HS_MAX_AGE}s)"
    fi
  else
    fail "Belum ada handshake"
  fi
fi

# 3) Default route
if [[ "$FAIL" -eq 0 ]]; then
  ROUTE=$(ip -4 route show default | head -1 | tr -s ' ')
  if echo "$ROUTE" | grep -qE "\\bdev\\s+${WG_IFACE}\\b"; then
    pass "Default route via $WG_IFACE"
  else
    fail "Default route BUKAN via $WG_IFACE"
  fi
fi

# 4) CONNMARK rules
if [[ "$FAIL" -eq 0 ]]; then
  if iptables -t mangle -S OUTPUT 2>/dev/null | grep -Fq "0xc8"; then
    pass "CONNMARK/mark rule ada"
  else
    fail "CONNMARK/mark rule tidak ada"
  fi
fi

# 5) Optional egress check
if [[ "$FAIL" -eq 0 && -n "$EXPECTED_IP" ]]; then
  EGRESS=$(curl -4 -s --max-time "$CURL_TIMEOUT" ifconfig.me 2>/dev/null || true)
  if [[ -z "$EGRESS" ]]; then
    warn "Tidak bisa verifikasi egress IP (timeout/empty)"
  elif [[ "$EGRESS" == "$EXPECTED_IP" ]]; then
    pass "Egress IP sesuai: $EGRESS"
  else
    fail "Egress IP tidak sesuai: $EGRESS (expected $EXPECTED_IP)"
  fi
fi

if [[ "$FAIL" -eq 0 ]]; then
  suffix=""; [[ -n "$EGRESS" ]] && suffix=" (egress=$EGRESS)"
  log "OK — all critical checks passed${suffix}"
  echo -e "$OUT"
  [[ "$WARN" -eq 1 ]] && log "WARN — non-critical check had warnings" || true
  exit 0
fi

log "PROBLEM — attempting recovery"
echo -e "$OUT"

# Recovery attempt
recovered=0
if systemctl restart "wg-quick@${WG_IFACE}" 2>/dev/null; then
  sleep "$RESTART_GRACE"
else
  wg-quick down "$WG_IFACE" 2>/dev/null || true
  ip link delete "$WG_IFACE" 2>/dev/null || true
  systemctl start "wg-quick@${WG_IFACE}" 2>/dev/null || true
  sleep "$RESTART_GRACE"
fi

if ip link show "$WG_IFACE" &>/dev/null; then
  recovered=1
  log "RECOVERED — interface is up"
else
  log "FAILED — interface still down"
fi

# Telegram notify
utc=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
route_now=$(ip -4 route show default | head -1 | tr -s ' ' 2>/dev/null || true)
eg_now=$(curl -4 -s --max-time 8 ifconfig.me 2>/dev/null || true)
status="FAILED"; [[ "$recovered" -eq 1 ]] && status="RECOVERED"

last_line=$(tail -n 1 /var/log/wg-health-check.log 2>/dev/null | sed 's/\r//')

printf -v msg 'WG ALERT [%s] %s\nTime: %s\nroute: %s\negress: %s (expected: %s)\nhandshake_age: %ss\nlast: %s' \
  "$status" "$hn" "$utc" "${route_now:-unknown}" "${eg_now:-unknown}" "${EXPECTED_IP:-n/a}" "${AGE:-NA}" "$last_line"

key_src="${hn}|${status}|${route_now:-}|${eg_now:-}|${AGE:-NA}"
key=$(printf '%s' "$key_src" | sha256sum | awk '{print $1}')

/usr/local/bin/wg-telegram-notify.sh "$msg" "$key" || true

[[ "$recovered" -eq 1 ]] && exit 0 || exit 1

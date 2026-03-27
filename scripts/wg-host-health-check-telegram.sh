#!/bin/bash
# WireGuard HOST health check + Telegram alert on problems
#
# Usage:
#   wg-host-health-check-telegram.sh [INTERFACE]
#
# Env:
#   HS_MAX_AGE (default 600)
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (required for sending alerts)
#
# Requires:
#   /usr/local/bin/wg-telegram-notify.sh

set -euo pipefail

WG_IFACE="${1:-wg0}"
HS_MAX_AGE="${HS_MAX_AGE:-600}"

LOG="/var/log/wg-host-health-check.log"
log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# rotate (1MB)
if [[ -f "$LOG" ]]; then
  sz=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
  if [[ "$sz" -gt 1048576 ]]; then
    mv "$LOG" "${LOG}.old" 2>/dev/null || true
  fi
fi

FAIL=0
OUT=""
pass(){ OUT+="  ✓ $*\n"; }
fail(){ OUT+="  ✗ $*\n"; FAIL=1; }

hn=$(hostname)

if ip link show "$WG_IFACE" &>/dev/null; then
  pass "Interface $WG_IFACE aktif"
else
  fail "Interface $WG_IFACE TIDAK aktif"
fi

listen_port=$(wg show "$WG_IFACE" listen-port 2>/dev/null || true)
udp_listeners=$(ss -H -uln 2>/dev/null || true)
if [[ -n "$listen_port" && "$listen_port" -gt 0 ]] \
   && grep -qE "(^|[[:space:]])([^[:space:]]+:)?${listen_port}([[:space:]]|$)" <<< "$udp_listeners"; then
  pass "UDP ${listen_port} listening"
else
  fail "UDP ${listen_port:-unknown} tidak listening"
fi

if sysctl -n net.ipv4.ip_forward 2>/dev/null | grep -q '^1$'; then pass "ip_forward=1"; else fail "ip_forward!=1"; fi
if iptables -t nat -C POSTROUTING -s 10.0.0.0/24 ! -o "$WG_IFACE" -j MASQUERADE 2>/dev/null; then pass "NAT MASQUERADE rule OK"; else fail "NAT MASQUERADE rule missing"; fi

now=$(date +%s)
peers=$(wg show "$WG_IFACE" peers 2>/dev/null || true)
if [[ -z "$peers" ]]; then
  fail "Tidak ada peers terdaftar"
else
  while read -r peer; do
    ts=$(wg show "$WG_IFACE" latest-handshakes 2>/dev/null | awk -v p="$peer" '$1==p{print $2}')
    short=${peer:0:8}
    if [[ -z "$ts" || "$ts" -le 0 ]]; then
      fail "Peer $short… belum handshake"
    else
      age=$(( now - ts ))
      if [[ "$age" -le "$HS_MAX_AGE" ]]; then pass "Peer $short… ${age}s"; else fail "Peer $short… terlalu lama ${age}s"; fi
    fi
  done <<< "$peers"
fi

if [[ "$FAIL" -eq 0 ]]; then
  log "OK — host checks passed"
  echo -e "$OUT"
  exit 0
fi

log "PROBLEM — host checks failed"
echo -e "$OUT"

utc=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
last_line=$(tail -n 1 /var/log/wg-host-health-check.log 2>/dev/null | sed 's/\r//')

printf -v msg 'WG ALERT [HOST PROBLEM] %s\nTime: %s\nlast: %s\n\nDetails:\n%s' \
  "$hn" "$utc" "$last_line" "$OUT"

key=$(printf '%s' "$hn|HOST|$OUT" | sha256sum | awk '{print $1}')
/usr/local/bin/wg-telegram-notify.sh "$msg" "$key" || true
exit 1

#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# wg-health-check.sh — Cek kesehatan tunnel + auto-recovery
#
# Usage:
#   wg-health-check.sh [INTERFACE] [EXPECTED_IP]
#
# Contoh:
#   wg-health-check.sh wg0                      # Check tanpa verifikasi IP
#   wg-health-check.sh wg0 103.253.212.145      # Check + verifikasi IP
#
# Deploy ke: /usr/local/bin/wg-health-check.sh
# ═══════════════════════════════════════════════════════════════

WG_IFACE="${1:-wg0}"
EXPECTED_IP="${2:-}"
LOG="/var/log/wg-health-check.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# Rotasi log sederhana (max 1MB)
if [[ -f "$LOG" ]]; then
    LOG_SIZE=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
    if [[ "$LOG_SIZE" -gt 1048576 ]]; then
        mv "$LOG" "${LOG}.old"
    fi
fi

FAIL=0
CHECKS=""

# ── Check 1: Interface aktif ────────────────────────────────
if ip link show "$WG_IFACE" &>/dev/null; then
    CHECKS+="  ✓ Interface ${WG_IFACE} aktif\n"
else
    CHECKS+="  ✗ Interface ${WG_IFACE} TIDAK aktif\n"
    FAIL=1
fi

# ── Check 2: Peer handshake segar (< 180 detik) ─────────────
if [[ $FAIL -eq 0 ]]; then
    LAST_HS=$(wg show "$WG_IFACE" latest-handshakes 2>/dev/null \
        | awk '{print $2}' | head -1)
    NOW=$(date +%s)

    if [[ -n "$LAST_HS" && "$LAST_HS" -gt 0 ]]; then
        AGE=$(( NOW - LAST_HS ))
        if [[ $AGE -lt 180 ]]; then
            CHECKS+="  ✓ Handshake: ${AGE}s lalu\n"
        else
            CHECKS+="  ✗ Handshake terlalu lama: ${AGE}s (> 180s)\n"
            FAIL=1
        fi
    else
        CHECKS+="  ✗ Belum ada handshake\n"
        FAIL=1
    fi
fi

# ── Check 3: Default route via tunnel ────────────────────────
if [[ $FAIL -eq 0 ]]; then
    if ip -4 route show default | head -1 | grep -q "$WG_IFACE"; then
        CHECKS+="  ✓ Default route via ${WG_IFACE}\n"
    else
        CHECKS+="  ✗ Default route BUKAN via ${WG_IFACE}\n"
        FAIL=1
    fi
fi

# ── Check 4: IP sesuai (opsional) ────────────────────────────
if [[ $FAIL -eq 0 && -n "$EXPECTED_IP" ]]; then
    DETECTED=$(curl -4 -s --max-time 10 ifconfig.me 2>/dev/null)
    if [[ "$DETECTED" == "$EXPECTED_IP" ]]; then
        CHECKS+="  ✓ IP: ${DETECTED} (sesuai)\n"
    elif [[ -z "$DETECTED" ]]; then
        CHECKS+="  ✗ Tidak bisa cek IP (timeout)\n"
        FAIL=1
    else
        CHECKS+="  ✗ IP: ${DETECTED} (seharusnya ${EXPECTED_IP})\n"
        FAIL=1
    fi
fi

# ── Check 5: CONNMARK rules aktif ───────────────────────────
if [[ $FAIL -eq 0 ]]; then
    if iptables -t mangle -L OUTPUT -n 2>/dev/null | grep -q "0xc8"; then
        CHECKS+="  ✓ CONNMARK rules aktif\n"
    else
        CHECKS+="  ✗ CONNMARK rules TIDAK ada\n"
        FAIL=1
    fi
fi

# ── Hasil ────────────────────────────────────────────────────
if [[ $FAIL -eq 0 ]]; then
    log "OK — semua check passed"
    echo -e "$CHECKS"
    exit 0
fi

# ── Auto-Recovery ────────────────────────────────────────────
log "PROBLEM — mencoba restart..."
echo -e "$CHECKS"

# Restart tunnel
systemctl restart wg-quick@"$WG_IFACE"
sleep 5

if ip link show "$WG_IFACE" &>/dev/null; then
    log "RECOVERED — restart berhasil"
    exit 0
else
    log "FAILED — restart gagal, perlu pengecekan manual"
    exit 1
fi

#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# tunnel-down.sh — Dipanggil oleh wg-quick PreDown
#
# Fungsi: Bersihkan semua perubahan routing dan kembalikan ke
# normal. Script ini TIDAK pakai set -e agar semua langkah
# cleanup tetap berjalan walaupun ada yang error.
#
# Usage: tunnel-down.sh [INTERFACE]
# Dipanggil oleh wg-quick via PreDown:
#   PreDown = /etc/wireguard/tunnel-down.sh %i
# ═══════════════════════════════════════════════════════════════

WG_IFACE="${1:-wg0}"
STATE_FILE="/run/wg-tunnel-${WG_IFACE}.state"
MARK=200
TABLE=200

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*" >&2; }

# ── 1. Baca state yang disimpan tunnel-up ────────────────────
if [[ -f "$STATE_FILE" ]]; then
    source "$STATE_FILE"
else
    warn "State file tidak ada, mencoba deteksi otomatis..."
    DEF_GW=$(ip -4 route show table "$TABLE" default 2>/dev/null | head -1 | awk '{print $3}')
    DEF_IF=$(ip -4 route show table "$TABLE" default 2>/dev/null | head -1 | awk '{print $5}')
    ENDPOINT=$(grep -m1 'Endpoint' /etc/wireguard/${WG_IFACE}.conf 2>/dev/null \
        | sed 's/.*=\s*//;s/:.*//' | tr -d ' ')
fi

echo ""
echo -e "${YELLOW}  Menghentikan tunnel ${WG_IFACE}...${NC}"

# ── 2. Hapus CONNMARK iptables rules ────────────────────────
if [[ -n "$DEF_IF" ]]; then
    iptables -t mangle -D PREROUTING -i "$DEF_IF" \
        -j CONNMARK --set-mark "$MARK" 2>/dev/null || true
fi
iptables -t mangle -D OUTPUT -m connmark --mark "$MARK" \
    -j MARK --set-mark "$MARK" 2>/dev/null || true
ok "CONNMARK rules dihapus"

# ── 3. Hapus policy routing ──────────────────────────────────
ip rule del fwmark "$MARK" table "$TABLE" 2>/dev/null || true
ip route flush table "$TABLE" 2>/dev/null || true
ok "Policy routing dihapus"

# ── 4. Hapus bypass route endpoint ───────────────────────────
if [[ -n "$ENDPOINT" ]]; then
    ip route del "${ENDPOINT}/32" 2>/dev/null || true
fi
ok "Bypass route dihapus"

# ── 5. Kembalikan default route ──────────────────────────────
if [[ -n "$DEF_GW" && -n "$DEF_IF" ]]; then
    ip route replace default via "$DEF_GW" dev "$DEF_IF"
    ok "Default route → ${DEF_GW} via ${DEF_IF}"
else
    fail "Tidak bisa restore default route otomatis!"
    fail "Jalankan manual: ip route add default via <GATEWAY> dev <INTERFACE>"
fi

# ── 6. Cleanup ───────────────────────────────────────────────
rm -f "$STATE_FILE"

echo ""
echo -e "${GREEN}  ✓ Tunnel dihentikan, routing dikembalikan ke normal${NC}"
echo ""

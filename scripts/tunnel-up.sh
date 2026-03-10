#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# tunnel-up.sh — Dipanggil oleh wg-quick PostUp
#
# Fungsi:
#   1. Arahkan semua traffic internet via WireGuard tunnel
#   2. Jaga agar koneksi masuk (SSH, dll) tetap dibalas via
#      interface fisik menggunakan CONNMARK
#
# PENTING: CONNMARK dipasang SEBELUM default route diubah,
# sehingga koneksi SSH yang sedang aktif tidak putus.
#
# Usage: tunnel-up.sh [INTERFACE]
# Dipanggil oleh wg-quick via PostUp:
#   PostUp = /etc/wireguard/tunnel-up.sh %i
# ═══════════════════════════════════════════════════════════════
set -e

WG_IFACE="${1:-wg0}"
STATE_FILE="/run/wg-tunnel-${WG_IFACE}.state"
MARK=200
TABLE=200

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*" >&2; }
info() { echo -e "  ${CYAN}→${NC} $*"; }

# ── 1. Deteksi default gateway ───────────────────────────────
DEF_GW=$(ip -4 route show default | head -1 | awk '{print $3}')
DEF_IF=$(ip -4 route show default | head -1 | awk '{print $5}')

if [[ -z "$DEF_GW" || -z "$DEF_IF" ]]; then
    fail "Tidak bisa mendeteksi default gateway!"
    exit 1
fi

# ── 2. Baca endpoint VPS Host dari config ────────────────────
ENDPOINT=$(grep -m1 'Endpoint' /etc/wireguard/${WG_IFACE}.conf \
    | sed 's/.*=\s*//;s/:.*//' | tr -d ' ')

if [[ -z "$ENDPOINT" ]]; then
    fail "Endpoint tidak ditemukan di /etc/wireguard/${WG_IFACE}.conf!"
    exit 1
fi

# ── 3. Simpan state ──────────────────────────────────────────
cat > "$STATE_FILE" << EOF
DEF_GW=${DEF_GW}
DEF_IF=${DEF_IF}
ENDPOINT=${ENDPOINT}
EOF

echo ""
info "Gateway: ${DEF_GW} via ${DEF_IF}"
info "Endpoint VPS Host: ${ENDPOINT}"
echo ""

# ── 4. Bypass route untuk endpoint VPS Host ──────────────────
#    Paket WireGuard (UDP) ke VPS Host harus lewat jalur fisik
#    langsung, bukan masuk ke tunnel (mencegah routing loop).
ip route add "${ENDPOINT}/32" via "$DEF_GW" dev "$DEF_IF" 2>/dev/null \
    || true
ok "Bypass route: ${ENDPOINT} → langsung via ${DEF_IF}"

# ── 5. CONNMARK + policy routing (SEBELUM ganti default route!)
#
#    Cara kerja:
#    - PREROUTING: semua paket yang masuk via interface fisik →
#      tandai koneksi di conntrack (CONNMARK = 200).
#      Menandai SEMUA paket (bukan hanya NEW) agar koneksi SSH
#      yang sudah ada juga ter-mark.
#    - OUTPUT: saat kernel membuat paket balasan (reply), restore
#      CONNMARK ke packet mark (MARK = 200)
#    - ip rule: paket dengan mark 200 → gunakan routing table 200
#    - table 200: default route via gateway fisik
#
#    Hasilnya: SSH masuk via eth0 → reply keluar via eth0 ✓
#              curl dari VPS → keluar via wg0 (tunnel) ✓
#
#    PENTING: ini dipasang SEBELUM default route diubah ke tunnel,
#    agar koneksi SSH yang sedang aktif langsung terlindungi.

ip rule add fwmark "$MARK" table "$TABLE" priority 100 2>/dev/null || true
ip route replace default via "$DEF_GW" dev "$DEF_IF" table "$TABLE"

# Gunakan -C (check) sebelum -A (append) untuk hindari duplikat
iptables -t mangle -C PREROUTING -i "$DEF_IF" \
    -j CONNMARK --set-mark "$MARK" 2>/dev/null \
    || iptables -t mangle -A PREROUTING -i "$DEF_IF" \
        -j CONNMARK --set-mark "$MARK"

iptables -t mangle -C OUTPUT -m connmark --mark "$MARK" \
    -j MARK --set-mark "$MARK" 2>/dev/null \
    || iptables -t mangle -A OUTPUT -m connmark --mark "$MARK" \
        -j MARK --set-mark "$MARK"

ok "CONNMARK aktif: reply koneksi masuk → via ${DEF_IF}"

# Beri waktu agar paket SSH yang sedang berjalan sempat ter-mark
sleep 1

# ── 6. SEKARANG baru ganti default route ke tunnel ──────────
ip route replace default dev "$WG_IFACE"
ok "Default route → ${WG_IFACE} (semua traffic via tunnel)"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ Tunnel AKTIF${NC}"
echo -e "${GREEN}  ✓ Traffic internet → via ${WG_IFACE} (IP VPS Host)${NC}"
echo -e "${GREEN}  ✓ SSH langsung ke IP asli → tetap bisa (CONNMARK)${NC}"
echo -e "${GREEN}  ✓ SSH via ProxyJump VPS Host → tetap bisa${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo ""

# 07 — Referensi Cepat

Semua perintah penting dalam satu halaman. Bookmark halaman ini.

---

## Setup Awal

### Host (VPS A)

```bash
# Install
apt update && apt install -y wireguard iptables

# Generate key pair
umask 077
wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
cat /etc/wireguard/server.pub    # → Catat, berikan ke setiap Client

# IP forwarding
echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-wireguard.conf && sysctl --system

# Buat config (edit template dari configs/wg0-host.conf.example)
nano /etc/wireguard/wg0.conf
chmod 600 /etc/wireguard/wg0.conf

# Start + auto-start
wg-quick up wg0
systemctl enable wg-quick@wg0

# Firewall
ufw allow 51820/udp && ufw allow OpenSSH && ufw enable
```

### Client (VPS B/C)

```bash
# Install
apt update && apt install -y wireguard iptables iproute2 resolvconf

# Generate key pair
umask 077
wg genkey | tee /etc/wireguard/client.key | wg pubkey > /etc/wireguard/client.pub
cat /etc/wireguard/client.pub    # → Kirim ke Host

# Deploy script routing
# (copy dari scripts/tunnel-up.sh dan scripts/tunnel-down.sh)
chmod +x /etc/wireguard/tunnel-up.sh /etc/wireguard/tunnel-down.sh

# Buat config (edit template dari configs/wg0-client.conf.example)
nano /etc/wireguard/wg0.conf
chmod 600 /etc/wireguard/wg0.conf

# Start + auto-start
wg-quick up wg0
systemctl enable wg-quick@wg0

# Disable IPv6 (rekomendasi)
echo -e "net.ipv6.conf.all.disable_ipv6 = 1\nnet.ipv6.conf.default.disable_ipv6 = 1" \
    > /etc/sysctl.d/99-disable-ipv6.conf && sysctl --system
```

---

## Operasional

| Aksi | Perintah |
|------|----------|
| Nyalakan tunnel | `wg-quick up wg0` atau `systemctl start wg-quick@wg0` |
| Matikan tunnel | `wg-quick down wg0` atau `systemctl stop wg-quick@wg0` |
| Restart tunnel | `systemctl restart wg-quick@wg0` |
| Status WireGuard | `wg show` |
| Status service | `systemctl status wg-quick@wg0` |
| Log service | `journalctl -u wg-quick@wg0 --no-pager -n 50` |
| Live log | `journalctl -u wg-quick@wg0 -f` |
| Cek IP terdeteksi | `curl -4 ifconfig.me` |
| Cek default route | `ip route show default` |
| Cek CONNMARK | `iptables -t mangle -L -n -v` |
| Cek policy routing | `ip rule show && ip route show table 200` |
| Cek state file | `cat /run/wg-tunnel-wg0.state` |
| Health check manual | `wg-health-check.sh wg0 <IP_HOST>` |
| Log health check | `tail -f /var/log/wg-health-check.log` |
| Backup config | `cp /etc/wireguard/wg0.conf /etc/wireguard/wg0.conf.bak-$(date +%F)` |

---

## Manajemen Peer (di Host)

| Aksi | Perintah |
|------|----------|
| Lihat peers | `wg show wg0 peers` |
| Tambah peer (live) | `wg set wg0 peer <PUBKEY> allowed-ips 10.0.0.X/32` |
| Hapus peer (live) | `wg set wg0 peer <PUBKEY> remove` |
| List handshakes | `wg show wg0 latest-handshakes` |
| Transfer data | `wg show wg0 transfer` |

> ⚠️ Perubahan via `wg set` bersifat sementara. **Selalu update wg0.conf** agar persist setelah reboot.

---

## SSH ke VPS Client

```bash
# Jalur 1: SSH langsung ke IP asli (selalu bisa, berkat CONNMARK)
ssh root@<IP_ASLI_CLIENT>

# Jalur 2: SSH via ProxyJump melalui Host
ssh -J root@<IP_HOST> root@10.0.0.2

# Jalur 2b: Jika sudah setup ~/.ssh/config
ssh vps-b
```

---

## Diagnostik Cepat (Client)

```bash
echo "WG:    $(wg show wg0 latest-handshakes 2>/dev/null | awk '{print $2}' | head -1 | xargs -I{} date -d @{} '+%H:%M:%S' 2>/dev/null || echo 'N/A')"
echo "Route: $(ip route show default | head -1)"
echo "IP:    $(curl -4 -s --max-time 5 ifconfig.me || echo 'timeout')"
echo "CONN:  $(iptables -t mangle -L OUTPUT -n 2>/dev/null | grep -c '0xc8') rules"
echo "State: $(cat /run/wg-tunnel-wg0.state 2>/dev/null | tr '\n' ' ' || echo 'none')"
```

---

## Emergency Recovery (via VNC/Console)

```bash
# Matikan tunnel
wg-quick down wg0 2>/dev/null
ip link delete wg0 2>/dev/null

# Bersihkan routing
iptables -t mangle -F
ip rule del fwmark 200 table 200 2>/dev/null
ip route flush table 200 2>/dev/null

# Restore default route (ganti <GATEWAY> dengan gateway VPS)
ip route replace default via <GATEWAY> dev eth0

# Test
ping -c 3 1.1.1.1
```

---

## Lokasi File Penting

### Host

| File | Fungsi |
|------|--------|
| `/etc/wireguard/wg0.conf` | Config WireGuard server |
| `/etc/wireguard/server.key` | Private key (RAHASIA) |
| `/etc/wireguard/server.pub` | Public key (dibagikan ke client) |
| `/etc/sysctl.d/99-wireguard.conf` | IP forwarding setting |

### Client

| File | Fungsi |
|------|--------|
| `/etc/wireguard/wg0.conf` | Config WireGuard client |
| `/etc/wireguard/client.key` | Private key (RAHASIA) |
| `/etc/wireguard/client.pub` | Public key (dikirim ke host) |
| `/etc/wireguard/tunnel-up.sh` | Script routing tunnel |
| `/etc/wireguard/tunnel-down.sh` | Script cleanup routing |
| `/usr/local/bin/wg-health-check.sh` | Script health check |
| `/run/wg-tunnel-wg0.state` | State file (runtime, hilang setelah reboot) |
| `/var/log/wg-health-check.log` | Log health check |
| `/etc/sysctl.d/99-disable-ipv6.conf` | Disable IPv6 setting |

### Systemd

| File | Fungsi |
|------|--------|
| `wg-quick@wg0.service` | Auto-start WireGuard (built-in) |
| `/etc/systemd/system/wg-health-check.service` | Health check service |
| `/etc/systemd/system/wg-health-check.timer` | Timer health check (5 menit) |
| `/etc/systemd/system/wg-quick@wg0.service.d/delay.conf` | Boot delay (opsional) |

---

## Alokasi IP Tunnel

| IP | Digunakan Oleh |
|----|---------------|
| 10.0.0.1 | VPS Host (Gateway) |
| 10.0.0.2 | Client 1 |
| 10.0.0.3 | Client 2 |
| 10.0.0.4 | Client 3 |
| ... | ... |
| 10.0.0.254 | Client 253 |

---

## Marks & Tables

| Nilai | Hex | Digunakan Untuk |
|-------|-----|-----------------|
| Mark 200 | 0xc8 | CONNMARK — tandai koneksi masuk via interface fisik |
| Table 200 | - | Routing table untuk traffic yang di-mark |
| Priority 100 | - | Prioritas ip rule (lebih tinggi dari default 32766) |

---

**Sebelumnya:** [06 — Skenario Lanjutan & What-If](06-skenario-lanjutan.md)

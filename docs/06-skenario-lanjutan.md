# 06 — Skenario Lanjutan & What-If

## Daftar Isi

- [What If: VPS Host Mati?](#what-if-vps-host-mati)
- [What If: Ingin Menambah Client Baru?](#what-if-ingin-menambah-client-baru)
- [What If: Ingin Punya Beberapa VPS Host?](#what-if-ingin-punya-beberapa-vps-host)
- [What If: Client Ingin Pindah Host?](#what-if-client-ingin-pindah-host)
- [What If: IP VPS Host Berubah?](#what-if-ip-vps-host-berubah)
- [What If: Ingin Rotasi Key?](#what-if-ingin-rotasi-key)
- [What If: Provider Memblokir WireGuard (UDP)?](#what-if-provider-memblokir-wireguard-udp)
- [What If: Ingin Split Tunnel (Bukan Full Tunnel)?](#what-if-ingin-split-tunnel-bukan-full-tunnel)
- [What If: Ingin Tunnel IPv6 Juga?](#what-if-ingin-tunnel-ipv6-juga)
- [What If: Internet Lambat Setelah Tunnel Aktif?](#what-if-internet-lambat-setelah-tunnel-aktif)
- [What If: VPS Client Pindah Provider (IP Berubah)?](#what-if-vps-client-pindah-provider-ip-berubah)
- [What If: Ingin Monitoring dari Luar?](#what-if-ingin-monitoring-dari-luar)
- [What If: Ingin Komunikasi Antar Client (VPS B ↔ VPS C)?](#what-if-ingin-komunikasi-antar-client-vps-b--vps-c)
- [What If: Port 51820 Sudah Dipakai?](#what-if-port-51820-sudah-dipakai)
- [What If: Ingin Menjalankan Service di Client yang Diakses dari Internet?](#what-if-ingin-menjalankan-service-di-client-yang-diakses-dari-internet)
- [What If: Seluruh Config Hilang?](#what-if-seluruh-config-hilang)

---

## What If: VPS Host Mati?

### Dampak

| Aspek | Status |
|-------|--------|
| SSH ke Client via IP asli | ✅ Tetap bisa (CONNMARK melindungi) |
| SSH via ProxyJump | ❌ Tidak bisa (Host down) |
| Internet di Client | ❌ Timeout (default route ke wg0 tapi tunnel mati) |
| Tunnel auto-recovery | ✅ Otomatis reconnect setelah Host kembali |

### Apa yang Terjadi di Client?

1. WireGuard handshake timeout
2. Default route masih `default dev wg0` tapi tunnel tidak bisa kirim data
3. `curl ifconfig.me` → timeout
4. SSH via IP asli **tetap bisa** (reply keluar via eth0 berkat CONNMARK)

### Apa yang Harus Dilakukan?

**Tidak perlu apa-apa.** Setelah Host kembali online:
1. WireGuard Client mengirim ulang handshake (PersistentKeepalive)
2. Tunnel re-establish otomatis
3. Internet kembali normal

### Jika Ingin Internet Tetap Jalan saat Host Mati

Anda perlu **fallback route**. Tambahkan di tunnel-up.sh:

```bash
# Setelah ip route replace default dev "$WG_IFACE":
# Tambah fallback route dengan metric lebih tinggi
ip route add default via "$DEF_GW" dev "$DEF_IF" metric 100 2>/dev/null || true
```

Dengan ini, jika tunnel timeout, kernel akan fallback ke route fisik (metric 100). Tapi IP yang terlihat akan jadi IP asli Client — bukan IP Host.

---

## What If: Ingin Menambah Client Baru?

### Langkah di VPS Host

```bash
# 1. Tambah peer (tanpa restart)
wg set wg0 peer <PUBLIC_KEY_CLIENT_BARU> allowed-ips 10.0.0.X/32

# 2. Simpan ke config
nano /etc/wireguard/wg0.conf
# Tambah blok [Peer] di akhir:
# [Peer]
# # Client Baru
# PublicKey = <PUBLIC_KEY>
# AllowedIPs = 10.0.0.X/32
```

### Langkah di VPS Client Baru

Ikuti [03 — Setup Client](03-setup-client.md) dari awal.

### Alokasi IP

| Client | IP Tunnel |
|--------|-----------|
| Client 1 (VPS B) | 10.0.0.2 |
| Client 2 (VPS C) | 10.0.0.3 |
| Client 3 | 10.0.0.4 |
| Client 4 | 10.0.0.5 |
| ... | ... |
| Client 253 | 10.0.0.254 |

> Subnet /24 mendukung hingga 253 client. Jika butuh lebih, ganti ke /16.

### Tips

- **Script `tunnel-up.sh` dan `tunnel-down.sh` identik** di semua client — tidak perlu edit
- Yang berbeda hanya: `Address` di wg0.conf dan `PrivateKey`
- Semua client bisa ditambahkan **tanpa restart** WireGuard di Host

---

## What If: Ingin Punya Beberapa VPS Host?

Gunakan subnet berbeda per Host:

### Setup

| VPS Host | Subnet | Address | ListenPort |
|----------|--------|---------|------------|
| Host A | 10.0.1.0/24 | 10.0.1.1/24 | 51820 |
| Host D | 10.0.2.0/24 | 10.0.2.1/24 | 51820 |
| Host E | 10.0.3.0/24 | 10.0.3.1/24 | 51820 |

### Di Client

Buat config terpisah per Host:

```
/etc/wireguard/via-host-a.conf    → tunnel ke Host A (Endpoint: IP_A)
/etc/wireguard/via-host-d.conf    → tunnel ke Host D (Endpoint: IP_D)
```

Script `tunnel-up.sh` dan `tunnel-down.sh` **tidak perlu diubah** — mereka otomatis membaca Endpoint dari config WireGuard yang aktif.

### Switching Host

```bash
wg-quick down via-host-a
wg-quick up via-host-d
```

> ⚠️ Hanya SATU tunnel yang boleh aktif pada satu waktu di satu Client.

---

## What If: Client Ingin Pindah Host?

### Opsi A: Ganti Config di Tempat

```bash
wg-quick down wg0
# Edit wg0.conf: ganti Endpoint, PublicKey, dan Address
nano /etc/wireguard/wg0.conf
wg-quick up wg0
```

### Opsi B: Config Multiple (Recommended)

```bash
# Setup sekali
cp /etc/wireguard/wg0.conf /etc/wireguard/via-host-a.conf
# Buat config untuk host baru
nano /etc/wireguard/via-host-d.conf

# Switching
wg-quick down via-host-a
wg-quick up via-host-d
```

### Yang Perlu Diingat

- Key pair Client **tetap sama** — tidak perlu generate ulang
- Public Key Client harus didaftarkan di **kedua** Host
- Script routing (`tunnel-up.sh`, `tunnel-down.sh`) tidak perlu diubah

---

## What If: IP VPS Host Berubah?

### Di Semua Client

```bash
wg-quick down wg0
sed -i 's/IP_LAMA/IP_BARU/g' /etc/wireguard/wg0.conf
wg-quick up wg0
```

### Di Host

Tidak perlu perubahan konfigurasi WireGuard. Hanya perlu memastikan:
- DNS/firewall diupdate ke IP baru
- Port 51820/UDP terbuka di IP baru

### Tips: Gunakan Domain

Jika IP sering berubah, gunakan domain name di Endpoint:

```ini
Endpoint = vpn-host.example.com:51820
```

WireGuard akan resolve domain ini secara periodik.

---

## What If: Ingin Rotasi Key?

### Di Host

```bash
wg-quick down wg0

# Generate key baru
wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub

# Update config
nano /etc/wireguard/wg0.conf    # Ganti PrivateKey

wg-quick up wg0
echo "Public Key baru: $(cat /etc/wireguard/server.pub)"
```

### Di SEMUA Client

```bash
wg-quick down wg0
# Ganti PublicKey di wg0.conf dengan public key BARU dari Host
nano /etc/wireguard/wg0.conf
wg-quick up wg0
```

### Di Client (rotasi key Client sendiri)

```bash
wg-quick down wg0

# Generate key baru
wg genkey | tee /etc/wireguard/client.key | wg pubkey > /etc/wireguard/client.pub

# Update config Client
nano /etc/wireguard/wg0.conf    # Ganti PrivateKey

echo "Public Key baru: $(cat /etc/wireguard/client.pub)"

# ⚠️ Kirim public key baru ke Host dan update peer!
```

Di Host:
```bash
# Hapus peer lama
wg set wg0 peer <OLD_PUBLIC_KEY> remove
# Tambah peer baru
wg set wg0 peer <NEW_PUBLIC_KEY> allowed-ips 10.0.0.2/32
# Update config file juga
nano /etc/wireguard/wg0.conf
```

---

## What If: Provider Memblokir WireGuard (UDP)?

Beberapa ISP/provider memblokir traffic UDP non-standar. Tanda-tanda:
- `wg-quick up` berhasil tapi tidak ada handshake
- `nc -uzv <IP_HOST> 51820` gagal dari Client
- Port Host terbuka (test dari VPS lain berhasil)

### Solusi 1: Ganti Port ke yang Umum

```ini
# Di Host wg0.conf:
ListenPort = 443

# Di Client wg0.conf:
Endpoint = <IP_HOST>:443
```

Port 443 biasanya terbuka karena digunakan HTTPS. Tapi ada resiko konflik jika Host menjalankan web server.

### Solusi 2: WireGuard over TCP (via udp2raw atau wstunnel)

```bash
# Di Host:
# Install udp2raw
wget https://github.com/wangyu-/udp2raw/releases/download/20230206.0/udp2raw_binaries.tar.gz
tar xf udp2raw_binaries.tar.gz
./udp2raw_amd64 -s -l 0.0.0.0:443 -r 127.0.0.1:51820 --raw-mode faketcp

# Di Client:
./udp2raw_amd64 -c -l 127.0.0.1:51820 -r <IP_HOST>:443 --raw-mode faketcp
# Ubah Endpoint di wg0.conf:
Endpoint = 127.0.0.1:51820
```

### Solusi 3: Gunakan Xray+tun2socks

Jika UDP benar-benar diblokir, kembali ke pendekatan Xray VLESS + tun2socks. Tapi gunakan CONNMARK yang benar (seperti di tutorial ini) untuk melindungi SSH.

---

## What If: Ingin Split Tunnel (Bukan Full Tunnel)?

Split tunnel = hanya traffic tertentu yang lewat tunnel, sisanya langsung.

### Di Client wg0.conf

Ganti `AllowedIPs`:

```ini
# Full tunnel (semua traffic):
AllowedIPs = 0.0.0.0/0

# Split tunnel (hanya traffic ke subnet tertentu):
AllowedIPs = 10.0.0.0/24, 192.168.1.0/24
```

### Di tunnel-up.sh

Jika split tunnel, Anda **TIDAK perlu** mengubah default route. Hapus langkah 6 (ganti default route) dari tunnel-up.sh, karena wg-quick dengan `Table = off` tidak mengubah route apapun.

### Kapan Split Tunnel Berguna?

- Ingin IP tertentu saja yang tersembunyi
- Ingin bandwidth lebih cepat untuk traffic umum
- Ingin akses private network (10.0.0.x) tanpa routing semua traffic

> ⚠️ Dengan split tunnel, `curl ifconfig.me` akan tetap menampilkan IP asli Client.

---

## What If: Ingin Tunnel IPv6 Juga?

### Di Host

```bash
# 1. Enable IPv6 forwarding
cat >> /etc/sysctl.d/99-wireguard.conf << 'EOF'
net.ipv6.conf.all.forwarding = 1
EOF
sysctl --system

# 2. Update wg0.conf di Host:
# Address = 10.0.0.1/24, fd10::1/64
# PostUp tambahkan:
# PostUp = ip6tables -t nat -A POSTROUTING -s fd10::/64 ! -o %i -j MASQUERADE
# PostDown tambahkan:
# PostDown = ip6tables -t nat -D POSTROUTING -s fd10::/64 ! -o %i -j MASQUERADE
```

### Di Client

```ini
# wg0.conf:
Address = 10.0.0.2/32, fd10::2/128
AllowedIPs = 0.0.0.0/0, ::/0
```

### Di tunnel-up.sh

Tambahkan IPv6 route:
```bash
ip -6 route replace default dev "$WG_IFACE"
```

> Ini lebih kompleks dan membutuhkan VPS Host yang punya IPv6. Sebagai alternatif
> sederhana, cukup **disable IPv6** di Client (lihat docs/03-setup-client.md Langkah 8).

---

## What If: Internet Lambat Setelah Tunnel Aktif?

### Penyebab yang Mungkin

1. **MTU terlalu besar** — paket terfragmentasi

   ```bash
   # Test MTU optimal
   ping -c 5 -M do -s 1400 1.1.1.1    # Jika gagal, turunkan
   ping -c 5 -M do -s 1380 1.1.1.1    # Cari nilai tertinggi yang berhasil
   
   # Set MTU di wg0.conf:
   # [Interface]
   # MTU = 1380
   ```

2. **Bandwidth VPS Host terbatas**

   ```bash
   # Test dari Host langsung:
   apt install -y speedtest-cli && speedtest
   ```

3. **Jarak geografis** (latency tinggi antara Client dan Host)

   ```bash
   ping -c 10 <IP_HOST>
   # Jika > 100ms, pertimbangkan Host yang lebih dekat
   ```

4. **Crypto overhead** — biasanya minimal di WireGuard (< 5%)

---

## What If: VPS Client Pindah Provider (IP Berubah)?

### Tidak Perlu Perubahan di Host

WireGuard di Host **tidak peduli** IP Public Client. Yang penting:
- Public Key Client sudah terdaftar
- Client bisa reach Host (Endpoint)

### Di Client

```bash
# Pastikan wg0.conf Endpoint masih benar (IP Host)
# Key pair dan config tetap sama
# Restart tunnel
systemctl restart wg-quick@wg0
```

### Yang Mungkin Berubah

- Gateway default → otomatis dideteksi oleh tunnel-up.sh
- Interface name → otomatis dideteksi oleh tunnel-up.sh
- SSH config di laptop perlu diupdate ke IP Client baru

---

## What If: Ingin Monitoring dari Luar?

### Opsi 1: HTTP Health Endpoint (Simple)

Buat script di Client yang expose status via HTTP:

```bash
# Install mini webserver
apt install -y busybox

# Buat health endpoint
cat > /usr/local/bin/wg-status-server.sh << 'SCRIPT'
#!/bin/bash
while true; do
    STATUS="OK"
    IP=$(curl -4 -s --max-time 5 ifconfig.me)
    WG=$(wg show wg0 2>&1 | head -5)
    
    RESPONSE="HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nStatus: ${STATUS}\nIP: ${IP}\n${WG}"
    echo -e "$RESPONSE" | busybox nc -l -p 8080 -q 1
done
SCRIPT
chmod +x /usr/local/bin/wg-status-server.sh
```

### Opsi 2: Push Notification

Tambahkan ke health check script:

```bash
# Di wg-health-check.sh, setelah FAILED:
curl -s "https://ntfy.sh/your-topic" -d "WireGuard tunnel FAILED on $(hostname)"
```

---

## What If: Ingin Komunikasi Antar Client (VPS B ↔ VPS C)?

Secara default, traffic antar Client melewati Host (Hub-and-Spoke). Ini sudah berfungsi jika:

1. **IP forwarding** aktif di Host
2. **FORWARD rules** mengizinkan traffic antar wg0

### Test

```bash
# Dari VPS B:
ping 10.0.0.3    # Ping VPS C via tunnel

# Dari VPS C:
ping 10.0.0.2    # Ping VPS B via tunnel
```

### Jika Tidak Bisa

Tambahkan FORWARD rule di Host:

```bash
# Di Host:
iptables -A FORWARD -i wg0 -o wg0 -j ACCEPT
```

---

## What If: Port 51820 Sudah Dipakai?

### Ganti Port

Di Host:
```ini
ListenPort = 51821    # atau port lain yang tersedia
```

Di semua Client:
```ini
Endpoint = <IP_HOST>:51821
```

### Cek Port yang Tersedia

```bash
ss -ulnp | grep 51820    # Cek apakah sudah terpakai
```

---

## What If: Ingin Menjalankan Service di Client yang Diakses dari Internet?

Karena Client menggunakan IP Host untuk keluar, service di Client **tidak bisa** diakses langsung dari internet via IP Client (karena reply akan keluar via tunnel).

### Solusi 1: Akses via IP Asli Client + Port Forwarding dengan CONNMARK

CONNMARK sudah menangani ini! Service yang **diakses via IP asli Client** (masuk via eth0) akan reply via eth0 juga. Jadi:

```bash
# Web server di VPS B port 80
# Akses dari internet: http://IP_ASLI_VPS_B:80 → bisa ✓
# Reply keluar via eth0 (CONNMARK) → benar ✓
```

### Solusi 2: Port Forward dari Host

```bash
# Di Host: forward port 8080 ke VPS B port 80
iptables -t nat -A PREROUTING -p tcp --dport 8080 -j DNAT --to-destination 10.0.0.2:80
iptables -A FORWARD -p tcp -d 10.0.0.2 --dport 80 -j ACCEPT
```

Akses: `http://IP_HOST:8080` → forward ke VPS B port 80.

---

## What If: Seluruh Config Hilang?

### Recovery dari Backup

```bash
# Jika ada backup
cp /etc/wireguard/wg0.conf.bak /etc/wireguard/wg0.conf
```

### Recovery dari Scratch

1. **Key pair** — jika hilang, harus generate baru dan update di SEMUA peer
2. **Config** — buat ulang dari template di `configs/` folder repository ini
3. **Script** — copy ulang dari `scripts/` folder repository ini

### Pencegahan

```bash
# Backup berkala
cp /etc/wireguard/wg0.conf /root/wg0.conf.backup-$(date +%F)
cp /etc/wireguard/tunnel-up.sh /root/tunnel-up.sh.backup
cp /etc/wireguard/tunnel-down.sh /root/tunnel-down.sh.backup

# Atau backup semua sekaligus
tar czf /root/wireguard-backup-$(date +%F).tar.gz /etc/wireguard/
```

---

**Sebelumnya:** [05 — Troubleshooting](05-troubleshooting.md)
**Selanjutnya:** [07 — Referensi Cepat](07-referensi-cepat.md)

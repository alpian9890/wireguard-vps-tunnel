# 05 — Troubleshooting

> Semua masalah di bawah ini **benar-benar terjadi** saat deployment nyata
> pada 3 VPS (1 host + 2 client). Setiap masalah disertai gejala, penyebab,
> dan solusi yang sudah teruji.

## Daftar Isi

- [Diagnostik Cepat](#diagnostik-cepat)
- [Masalah saat Install](#masalah-saat-install)
- [Masalah saat Konfigurasi](#masalah-saat-konfigurasi)
- [Masalah saat `wg-quick up`](#masalah-saat-wg-quick-up)
- [Masalah Konektivitas](#masalah-konektivitas)
- [Masalah SSH](#masalah-ssh)
- [Masalah Routing](#masalah-routing)
- [Masalah setelah Reboot](#masalah-setelah-reboot)
- [Emergency Recovery](#emergency-recovery)
- [Diagnostic Commands Reference](#diagnostic-commands-reference)

---

## Diagnostik Cepat

Jalankan perintah-perintah ini untuk identifikasi masalah:

```bash
echo "=== 1. WireGuard Status ==="
wg show 2>/dev/null || echo "WireGuard TIDAK aktif"

echo -e "\n=== 2. Interface ==="
ip link show wg0 2>/dev/null || echo "Interface wg0 TIDAK ada"

echo -e "\n=== 3. Default Route ==="
ip route show default

echo -e "\n=== 4. IP Terdeteksi ==="
curl -4 -s --max-time 5 ifconfig.me || echo "Tidak bisa cek IP (timeout/error)"

echo -e "\n=== 5. CONNMARK Rules ==="
iptables -t mangle -L PREROUTING -n 2>/dev/null | grep -c CONNMARK | \
    xargs -I{} sh -c '[ {} -gt 0 ] && echo "CONNMARK: aktif ({} rules)" || echo "CONNMARK: TIDAK ADA"'

echo -e "\n=== 6. Policy Routing ==="
ip rule show | grep "fwmark 0xc8" || echo "IP rule fwmark 200 TIDAK ada"

echo -e "\n=== 7. Routing Table 200 ==="
ip route show table 200 2>/dev/null || echo "Table 200 KOSONG"

echo -e "\n=== 8. State File ==="
cat /run/wg-tunnel-wg0.state 2>/dev/null || echo "State file TIDAK ada"

echo -e "\n=== 9. Service Status ==="
systemctl is-active wg-quick@wg0 2>/dev/null || echo "Service tidak terdaftar"
systemctl is-enabled wg-quick@wg0 2>/dev/null || echo "Auto-start tidak aktif"
```

---

## Masalah saat Install

### Problem: `resolvconf: command not found`

**Gejala:**
```
wg-quick up wg0
...
[#] resolvconf -a wg0 -m 0 -x
/usr/bin/wg-quick: line 32: resolvconf: command not found
[#] ip link delete dev wg0
```

**Penyebab:** `wg-quick` membutuhkan `resolvconf` untuk mengelola DNS. Jika tidak ada, wg-quick **gagal dan rollback semua perubahan** — interface yang baru dibuat langsung dihapus.

**Solusi:**
```bash
apt install -y resolvconf
wg-quick up wg0    # Coba lagi
```

**Alternatif (jika resolvconf tidak tersedia):**
```bash
# Hapus baris DNS dari config
sed -i '/^DNS/d' /etc/wireguard/wg0.conf
wg-quick up wg0
# DNS akan menggunakan /etc/resolv.conf yang sudah ada
```

> 🔍 **Konteks:** Masalah ini terjadi pada VPS B saat deployment pertama. Package
> `resolvconf` tidak terinstall secara default di Debian minimal.

---

### Problem: `wireguard` package tidak ditemukan

**Gejala:**
```
E: Unable to locate package wireguard
```

**Penyebab:** Kernel terlalu lama (< 5.6) atau repository belum update.

**Solusi:**
```bash
# 1. Update repository
apt update

# 2. Jika tetap tidak ada, install dari backports (Debian)
echo "deb http://deb.debian.org/debian $(lsb_release -cs)-backports main" \
    >> /etc/apt/sources.list.d/backports.list
apt update
apt install -y wireguard

# 3. Jika kernel terlalu lama
apt install -y linux-image-amd64 && reboot    # Debian
# atau
apt install -y linux-generic-hwe-18.04 && reboot    # Ubuntu 18.04
```

---

## Masalah saat Konfigurasi

### Problem: Endpoint menggunakan IP contoh dari tutorial

**Gejala:**
- `wg-quick up wg0` berhasil (tidak error)
- Tapi `wg show` tidak menampilkan handshake
- `curl -4 ifconfig.me` timeout

**Penyebab:** Endpoint di `wg0.conf` masih berisi IP contoh (`203.0.113.10`) bukan IP asli VPS Host.

**Cara deteksi:**
```bash
grep Endpoint /etc/wireguard/wg0.conf
# Cek: apakah ini IP ASLI VPS Host?
```

**Solusi:**
```bash
# Ganti dengan IP asli
sed -i 's/203.0.113.10/IP_ASLI_VPS_HOST/g' /etc/wireguard/wg0.conf
wg-quick down wg0 && wg-quick up wg0
```

> 🔍 **Konteks:** Masalah ini terjadi pada VPS B saat deployment. Config disalin dari
> tutorial tanpa mengganti IP contoh. WireGuard tidak memberikan error —
> hanya tidak ada handshake karena endpoint tidak bisa dihubungi.

---

### Problem: Public Key tidak cocok

**Gejala:**
- `wg-quick up wg0` berhasil
- Tapi `wg show` tidak menampilkan handshake
- Di VPS Host, `wg show` menampilkan peer tapi transfer = 0

**Penyebab:** Public key yang didaftarkan di VPS Host tidak cocok dengan key pair VPS Client (atau sebaliknya).

**Cara deteksi:**
```bash
# Di Client: lihat public key yang seharusnya
cat /etc/wireguard/client.pub

# Di Host: lihat public key yang terdaftar
grep PublicKey /etc/wireguard/wg0.conf
# atau
wg show wg0 peers

# Bandingkan: harus SAMA
```

**Solusi:**
1. Pastikan public key di VPS Host = output `cat /etc/wireguard/client.pub` di VPS Client
2. Pastikan public key di VPS Client config = output `cat /etc/wireguard/server.pub` di VPS Host
3. Jika berbeda, update dan restart WireGuard di kedua sisi

---

### Problem: Permission denied pada key file

**Gejala:**
```
Warning: `/etc/wireguard/wg0.conf' is world accessible
```

**Solusi:**
```bash
chmod 600 /etc/wireguard/wg0.conf
chmod 600 /etc/wireguard/*.key
```

---

## Masalah saat `wg-quick up`

### Problem: `RTNETLINK answers: Operation not supported`

**Penyebab:** WireGuard kernel module belum dimuat.

**Solusi:**
```bash
modprobe wireguard
# Jika gagal:
apt install -y wireguard-dkms
modprobe wireguard
wg-quick up wg0
```

---

### Problem: `RTNETLINK answers: File exists`

**Penyebab:** Interface wg0 sudah ada dari percobaan sebelumnya.

**Solusi:**
```bash
wg-quick down wg0 2>/dev/null
ip link delete wg0 2>/dev/null
wg-quick up wg0
```

---

### Problem: Script tunnel-up.sh tidak ditemukan

**Gejala:**
```
/etc/wireguard/tunnel-up.sh: No such file or directory
```

**Solusi:**
```bash
# Pastikan script ada dan executable
ls -la /etc/wireguard/tunnel-up.sh
ls -la /etc/wireguard/tunnel-down.sh

# Jika tidak ada, deploy dari repository
# Lihat docs/03-setup-client.md Langkah 4
```

---

### Problem: Script tunnel-up.sh "Permission denied"

**Gejala:**
```
/etc/wireguard/tunnel-up.sh: Permission denied
```

**Solusi:**
```bash
chmod +x /etc/wireguard/tunnel-up.sh
chmod +x /etc/wireguard/tunnel-down.sh
```

---

## Masalah Konektivitas

### Problem: `curl -4 ifconfig.me` masih menampilkan IP asli Client

**Penyebab yang mungkin:**

1. **Default route bukan via wg0:**
   ```bash
   ip route show default
   # Jika bukan "default dev wg0" → tunnel-up.sh tidak berjalan
   ```
   Solusi: `wg-quick down wg0 && wg-quick up wg0`

2. **NAT Masquerade di Host tidak aktif:**
   ```bash
   # Di VPS Host:
   iptables -t nat -L POSTROUTING -n -v | grep MASQUERADE
   # Jika tidak ada → restart WireGuard di Host
   wg-quick down wg0 && wg-quick up wg0    # Di VPS Host
   ```

3. **IP forwarding di Host tidak aktif:**
   ```bash
   # Di VPS Host:
   sysctl net.ipv4.ip_forward
   # Jika 0: echo 1 > /proc/sys/net/ipv4/ip_forward
   ```

4. **AllowedIPs di Client bukan 0.0.0.0/0:**
   ```bash
   grep AllowedIPs /etc/wireguard/wg0.conf
   # Harus: AllowedIPs = 0.0.0.0/0
   ```

5. **⚠️ Software tunneling lain (tun2socks/Xray/V2Ray) menimpa default route:**
   ```bash
   # Cek apakah ada interface tun0 atau proses tunneling lain
   ip link show tun0 2>/dev/null && echo "BAHAYA: tun0 aktif!"
   ps aux | grep -E 'tun2socks|xray|v2ray' | grep -v grep

   # Cek default route — jika mengarah ke tun0, ini masalahnya!
   ip route show default
   # ❌ Salah: default dev tun0 scope link metric 1
   # ✅ Benar: default dev wg0 scope link
   ```

   **Solusi:**
   ```bash
   # 1. Matikan proses tunneling lama
   # Cari PID spesifik lalu kill satu per satu
   ps aux | grep -E 'tun2socks|xray' | grep -v grep
   kill <PID_XRAY> <PID_TUN2SOCKS>

   # 2. Hapus interface tun0
   ip link set tun0 down 2>/dev/null
   ip link delete tun0 2>/dev/null

   # 3. Nonaktifkan service lama secara permanen
   systemctl stop vpn-tunnel.service xray.service 2>/dev/null
   systemctl disable vpn-tunnel.service xray.service 2>/dev/null

   # 4. Bersihkan iptables rules lama yang mungkin tertinggal
   # Cek mangle table — seharusnya hanya ada CONNMARK rules kita
   iptables -t mangle -L -n -v --line-numbers
   # Jika ada rules lama (MARK set 0x64, interface "link", ctstate NEW),
   # hapus satu per satu:
   # iptables -t mangle -D <CHAIN> <LINE_NUMBER>

   # 5. Restart WireGuard
   wg-quick down wg0 && wg-quick up wg0
   ```

   > **Catatan penting:** Jika Anda sebelumnya menggunakan Xray+tun2socks,
   > pastikan service-nya di-disable. Jika dibiarkan aktif, saat reboot
   > service tersebut akan start dan menimpa default route WireGuard.
   > Selain itu, `systemctl stop vpn-tunnel.service` punya script cleanup
   > yang bisa **menghapus CONNMARK rules dan routing table WireGuard**,
   > menyebabkan VPS tidak bisa diakses (harus recovery via VNC).

---

### Problem: Host health-check melaporkan `UDP 51820 tidak listening`, padahal WireGuard normal

**Gejala:**
- `wg show` menampilkan `listening port: 51820`
- `ss -ulnp | grep 51820` juga menampilkan port WireGuard
- tapi `wg-host-health-check.sh` tetap fail di check UDP listening

**Penyebab:**
Versi awal script host memakai pipeline seperti ini:

```bash
ss -ulnp | grep -q ":51820"
```

Saat script dijalankan dengan `set -o pipefail`, `grep -q` bisa selesai lebih dulu setelah menemukan match, lalu `ss` menerima `SIGPIPE`. Akibatnya status pipeline bisa dianggap gagal dan muncul **false positive** walaupun port sebenarnya listening.

**Solusi:**
- Update ke versi script terbaru dari repository.
- Versi terbaru mengambil port dari `wg show <iface> listen-port`, lalu mencocokkannya tanpa pipeline `grep -q` langsung ke output `ss`.

**Verifikasi:**
```bash
wg show wg0 listen-port
ss -H -uln | grep ":$(wg show wg0 listen-port)"
/usr/local/bin/wg-host-health-check.sh wg0
```

Jika verifikasi manual match dan script versi baru pass, berarti masalah sebelumnya memang false positive.

---

### Problem: Tidak ada handshake (tunnel tidak established)

**Langkah debugging:**

```bash
# 1. Cek interface aktif
ip link show wg0

# 2. Cek endpoint benar
grep Endpoint /etc/wireguard/wg0.conf

# 3. Test konektivitas UDP ke Host (sebelum tunnel)
nc -uzv <IP_HOST> 51820 -w 3

# 4. Cek firewall di Host
# Di VPS Host:
ss -ulnp | grep 51820
iptables -L INPUT -n | grep 51820

# 5. Cek jam sistem
date
# Jam yang melenceng > 2 menit bisa menyebabkan handshake gagal

# 6. Cek log kernel
dmesg | tail -20 | grep -i wireguard
```

---

### Problem: Tunnel aktif tapi internet lambat

**Kemungkinan penyebab:**

1. **MTU terlalu besar:**
   ```bash
   # Cek MTU saat ini
   ip link show wg0 | grep mtu
   
   # Coba turunkan MTU
   wg-quick down wg0
   # Tambahkan di [Interface] di wg0.conf:
   # MTU = 1280
   wg-quick up wg0
   ```

2. **VPS Host bandwidth terbatas:**
   ```bash
   # Test speed dari Host langsung
   curl -o /dev/null -w "%{speed_download}" https://speed.hetzner.de/100MB.bin
   ```

3. **Jarak geografis antara Client dan Host:**
   ```bash
   # Test latency ke Host
   ping -c 10 <IP_HOST>
   ```

---

### Problem: DNS tidak resolve

**Gejala:** `curl ifconfig.me` timeout tapi `curl 1.1.1.1` bisa.

**Solusi:**
```bash
# 1. Cek resolv.conf
cat /etc/resolv.conf

# 2. Test DNS langsung
dig @1.1.1.1 google.com

# 3. Jika DNS kosong, set manual
echo "nameserver 1.1.1.1" > /etc/resolv.conf

# 4. Jika resolvconf override, edit wg0.conf
# Pastikan ada baris: DNS = 1.1.1.1, 8.8.8.8
```

---

## Masalah SSH

### Problem: SSH ke IP asli Client timeout saat tunnel aktif

**Ini masalah PALING KRITIS.** Penyebab yang mungkin:

#### Penyebab 1: CONNMARK rules tidak ada

```bash
# Cek
iptables -t mangle -L PREROUTING -n -v | grep CONNMARK
iptables -t mangle -L OUTPUT -n -v | grep "0xc8"

# Jika kosong → CONNMARK tidak dipasang
# Solusi: restart tunnel
systemctl restart wg-quick@wg0
```

#### Penyebab 2: Policy routing tidak ada

```bash
# Cek
ip rule show | grep "fwmark 0xc8"
ip route show table 200

# Jika tidak ada:
ip rule add fwmark 200 table 200 priority 100
DEF_GW=$(cat /run/wg-tunnel-wg0.state | grep DEF_GW | cut -d= -f2)
DEF_IF=$(cat /run/wg-tunnel-wg0.state | grep DEF_IF | cut -d= -f2)
ip route replace default via "$DEF_GW" dev "$DEF_IF" table 200
```

#### Penyebab 3: Script tunnel-up.sh versi lama (urutan salah)

```bash
# Cek apakah script memasang CONNMARK sebelum route change
head -80 /etc/wireguard/tunnel-up.sh | grep -n -E "CONNMARK|ip route replace default dev"
# CONNMARK harus muncul SEBELUM "ip route replace default dev"
```

Jika urutan salah, update script dari repository.

#### Penyebab 4: Script tunnel-up.sh pakai `--ctstate NEW`

```bash
grep "ctstate NEW" /etc/wireguard/tunnel-up.sh
# Jika ditemukan → ini bug!
# `--ctstate NEW` hanya mark koneksi BARU, koneksi SSH yang sudah ada tidak ter-mark
```

Solusi: hapus `--ctstate NEW` dari script. Update dari repository.

> 🔍 **Konteks:** Kedua bug ini (urutan salah + ctstate NEW) ditemukan saat deployment
> nyata. SSH session hang saat menjalankan `wg-quick up wg0`. Setelah fix kedua bug,
> SSH tetap connected saat tunnel dinyalakan.

---

### Problem: SSH hang saat `wg-quick up` dijalankan

**Penyebab:** Script tunnel-up.sh mengubah default route SEBELUM CONNMARK dipasang. Ada "gap" di mana SSH reply ikut default route (tunnel).

**Solusi darurat (jika sudah hang):**
1. Tunggu 30-60 detik — kadang koneksi pulih setelah CONNMARK akhirnya aktif
2. Jika tetap hang, masuk via VNC/Console:
   ```bash
   wg-quick down wg0
   ```
3. Update tunnel-up.sh ke versi yang benar (CONNMARK dulu, route terakhir)

**Pencegahan:**
- Pastikan tunnel-up.sh menggunakan urutan: CONNMARK → sleep 1 → route change
- Selalu punya akses VNC/Console sebelum pertama kali menjalankan tunnel

---

### Problem: SSH via ProxyJump gagal

```bash
ssh -J root@<IP_HOST> root@10.0.0.2
# Error: Connection refused

# Debug:
# 1. Pastikan bisa SSH ke Host dulu
ssh root@<IP_HOST>

# 2. Dari dalam Host, test SSH ke Client via tunnel IP
ssh root@10.0.0.2

# 3. Cek routing di Host
ping 10.0.0.2    # Dari Host

# 4. Cek SSH server di Client listening di semua interface
ss -tlnp | grep 22
# Harus: 0.0.0.0:22 (bukan 127.0.0.1:22)
```

---

## Masalah Routing

### Problem: Routing loop (traffic berputar tanpa keluar)

**Gejala:** Semua koneksi timeout, termasuk ke IP Host.

**Penyebab:** Bypass route untuk endpoint VPS Host tidak ada. Paket WireGuard (UDP) yang harusnya langsung ke Host malah masuk ke tunnel → routing loop.

**Solusi:**
```bash
# Cek bypass route
ip route show | grep <IP_HOST>

# Jika tidak ada:
DEF_GW=$(cat /run/wg-tunnel-wg0.state | grep DEF_GW | cut -d= -f2)
DEF_IF=$(cat /run/wg-tunnel-wg0.state | grep DEF_IF | cut -d= -f2)
ip route add <IP_HOST>/32 via "$DEF_GW" dev "$DEF_IF"
```

---

### Problem: Duplikat iptables rules setelah restart berkali-kali

**Gejala:** Ada beberapa rules CONNMARK yang sama.

**Cara cek:**
```bash
iptables -t mangle -L PREROUTING -n -v | grep CONNMARK
# Jika ada lebih dari 1 baris → duplikat
```

**Solusi:**
Script `tunnel-up.sh` sudah menggunakan `-C` (check) sebelum `-A` (append) untuk mencegah duplikat. Jika masih terjadi:

```bash
# Hapus semua dan restart
iptables -t mangle -F PREROUTING
iptables -t mangle -F OUTPUT
systemctl restart wg-quick@wg0
```

---

## Masalah setelah Reboot

### Problem: Service gagal start — "Tidak bisa mendeteksi default gateway"

**Gejala:**
```bash
journalctl -u wg-quick@wg0 --no-pager | tail -10
# ✗ Tidak bisa mendeteksi default gateway!
# wg-quick@wg0.service: Failed with result 'exit-code'.
```

**Penyebab:** Race condition — network belum ready saat systemd menjalankan
WireGuard. Default route belum terpasang saat `tunnel-up.sh` mencoba membacanya.

**Solusi 1 (Recommended): Update tunnel-up.sh ke v4 dengan retry loop:**

Script `tunnel-up.sh` v4 sudah memiliki retry loop bawaan yang menunggu
hingga 30 detik untuk default gateway. Pastikan script terbaru ter-deploy:

```bash
# Cek versi script — harus ada "MAX_RETRY" di dalamnya
grep 'MAX_RETRY' /etc/wireguard/tunnel-up.sh
# Jika tidak ada, update script dari repository
```

**Solusi 2 (Tambahan): Tambah delay di systemd service:**
```bash
mkdir -p /etc/systemd/system/wg-quick@wg0.service.d
cat > /etc/systemd/system/wg-quick@wg0.service.d/delay.conf << 'EOF'
[Unit]
After=network-online.target
Wants=network-online.target

[Service]
ExecStartPre=/bin/sleep 10
EOF

systemctl daemon-reload
```

> **Tips:** Gunakan kedua solusi bersamaan untuk keandalan maksimal.
> Solusi 1 menangani race condition di level script, Solusi 2 memberi
> jeda waktu tambahan di level systemd.

---

### Problem: Tunnel aktif tapi CONNMARK hilang setelah reboot

**Kemungkinan penyebab:** tunnel-up.sh error saat boot (tapi WireGuard tetap naik).

```bash
# Cek log
journalctl -u wg-quick@wg0 --no-pager | tail -30

# Manual fix
/etc/wireguard/tunnel-up.sh wg0
```

---

## Emergency Recovery

### Skenario: Tidak bisa SSH DAN tidak bisa internet

Masuk via **VNC/Console** dari dashboard provider VPS, lalu:

```bash
#!/bin/bash
# Emergency recovery script
# Jalankan via VNC/Console

# 1. Hapus tunnel
wg-quick down wg0 2>/dev/null
ip link delete wg0 2>/dev/null

# 2. Bersihkan mangle rules
iptables -t mangle -F PREROUTING 2>/dev/null
iptables -t mangle -F OUTPUT 2>/dev/null

# 3. Bersihkan policy routing
ip rule del fwmark 200 table 200 2>/dev/null
ip route flush table 200 2>/dev/null

# 4. Restore default route
# Cek gateway dari state file
if [ -f /run/wg-tunnel-wg0.state ]; then
    source /run/wg-tunnel-wg0.state
    ip route replace default via "$DEF_GW" dev "$DEF_IF"
else
    # Tebak dari network config
    # Ganti dengan gateway VPS Anda:
    ip route replace default via <GATEWAY> dev eth0
fi

# 5. Test
ping -c 3 1.1.1.1
curl -4 ifconfig.me
```

> ⚠️ **Ganti `<GATEWAY>` dengan gateway asli VPS Anda.**
> Gateway biasanya bisa dilihat di dashboard provider VPS.

### Cara Mengetahui Gateway Asli

```bash
# Dari dashboard provider biasanya ada info network
# Atau dari state file WireGuard
cat /run/wg-tunnel-wg0.state

# Atau dari routing table 200 (jika masih ada)
ip route show table 200

# Atau tebak dari IP VPS (biasanya .1 dari subnet)
# Contoh: VPS IP 202.155.94.5 → gateway biasanya 202.155.94.1
```

---

## Diagnostic Commands Reference

### WireGuard

```bash
wg show                          # Status lengkap
wg show wg0 latest-handshakes   # Waktu handshake terakhir
wg show wg0 transfer            # Transfer data
wg show wg0 peers               # List public key peers
ip addr show wg0                 # IP interface wg0
```

### Routing

```bash
ip route show default            # Default route
ip route show table 200          # Routing table 200
ip rule show                     # Policy routing rules
ip route show | grep <IP_HOST>   # Bypass route
```

### iptables

```bash
iptables -t mangle -L PREROUTING -n -v    # CONNMARK input rule
iptables -t mangle -L OUTPUT -n -v        # CONNMARK output rule
iptables -t nat -L POSTROUTING -n -v      # NAT masquerade (di Host)
iptables -L FORWARD -n -v                 # FORWARD rules (di Host)
```

### Systemd

```bash
systemctl status wg-quick@wg0              # Status service
systemctl is-enabled wg-quick@wg0          # Auto-start enabled?
journalctl -u wg-quick@wg0 --no-pager     # Log service
journalctl -u wg-quick@wg0 -f             # Live log
```

### Network

```bash
curl -4 ifconfig.me              # IP terdeteksi
ping -c 3 10.0.0.1              # Ping VPS Host via tunnel
ss -ulnp | grep 51820           # Port WireGuard (di Host)
nc -uzv <IP_HOST> 51820         # Test UDP port
```

### State Files

```bash
cat /run/wg-tunnel-wg0.state     # State dari tunnel-up.sh
cat /var/log/wg-health-check.log # Log health check
```

---

**Sebelumnya:** [04 — Otomasi & Monitoring](04-otomasi-dan-monitoring.md)
**Selanjutnya:** [06 — Skenario Lanjutan & What-If](06-skenario-lanjutan.md)

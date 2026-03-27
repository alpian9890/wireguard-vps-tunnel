# 02 — Setup Host (VPS A) sebagai WireGuard Gateway

## Daftar Isi

- [Topologi](#topologi)
- [Prasyarat](#prasyarat)
- [Langkah 1: Install WireGuard](#langkah-1-install-wireguard)
- [Langkah 2: Generate Key Pair](#langkah-2-generate-key-pair)
- [Langkah 3: Deteksi Interface Internet](#langkah-3-deteksi-interface-internet)
- [Langkah 4: Aktifkan IP Forwarding](#langkah-4-aktifkan-ip-forwarding)
- [Langkah 5: Konfigurasi WireGuard Server](#langkah-5-konfigurasi-wireguard-server)
- [Langkah 6: Jalankan WireGuard](#langkah-6-jalankan-wireguard)
- [Langkah 7: Firewall](#langkah-7-firewall)
- [Langkah 8: Verifikasi](#langkah-8-verifikasi)
- [Menambah Client Baru](#menambah-client-baru)
- [Menghapus Client](#menghapus-client)
- [Skalabilitas](#skalabilitas)
- [Checklist](#checklist)

---

## Topologi

```
VPS B (10.0.0.2) ──┐
                    ├── WireGuard Tunnel ──→ VPS A (10.0.0.1) ──→ Internet
VPS C (10.0.0.3) ──┘                       NAT: semua keluar
                                            dengan IP VPS A
```

### Contoh IP

| VPS | IP Public (contoh) | IP Tunnel | Peran |
|-----|--------------------|-----------|-------|
| A (host) | `203.0.113.10` | `10.0.0.1` | Gateway + NAT |
| B (client) | `198.51.100.20` | `10.0.0.2` | Client |
| C (client) | `198.51.100.30` | `10.0.0.3` | Client |

> ⚠️ **Ganti semua contoh IP dengan IP asli VPS Anda.**

---

## Prasyarat

- [ ] OS: Debian 11+ / Ubuntu 20.04+ / Linux dengan kernel ≥ 5.6
- [ ] Akses root ke VPS A
- [ ] Port **51820/UDP** terbuka dari internet
- [ ] Catat IP Public VPS A: `curl -4 ifconfig.me`

---

## Langkah 1: Install WireGuard

```bash
apt update && apt install -y wireguard iptables
```

### Verifikasi

```bash
wg --version
# Output contoh: wireguard-tools v1.0.20210914 - https://git.zx2c4.com/wireguard-tools/
```

### What If: `wireguard` package tidak ditemukan?

Pada kernel lama (< 5.6), WireGuard belum built-in. Install module terpisah:

```bash
# Debian 10 / Ubuntu 18.04
apt install -y wireguard-dkms wireguard-tools
```

Jika masih gagal, upgrade kernel:

```bash
apt install -y linux-image-amd64    # Debian
# atau
apt install -y linux-generic-hwe-18.04    # Ubuntu 18.04
reboot
```

---

## Langkah 2: Generate Key Pair

```bash
umask 077
wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
```

### Lihat hasilnya

```bash
echo "Private Key: $(cat /etc/wireguard/server.key)"
echo "Public Key : $(cat /etc/wireguard/server.pub)"
```

> 🔒 **Private Key** → hanya untuk VPS A, **JANGAN PERNAH dibagikan**
> 📋 **Public Key** → catat, akan dibutuhkan oleh setiap VPS Client

### Keamanan file key

```bash
ls -la /etc/wireguard/
# server.key harus: -rw------- (600) root root
# Jika tidak:
chmod 600 /etc/wireguard/server.key
```

---

## Langkah 3: Deteksi Interface Internet

Cari nama interface dan gateway publik VPS A:

```bash
ip -4 route show default
# Output contoh: default via 103.253.212.1 dev eth0
```

```bash
ip -4 route show default | awk '{print "Gateway:", $3, " Interface:", $5}'
# Output contoh: Gateway: 103.253.212.1  Interface: eth0
```

Interface bisa bernama `eth0`, `ens3`, `enp1s0`, `venet0`, dll — tergantung provider VPS.

> 💡 **Anda tidak perlu menghafal nama interface.** Konfigurasi WireGuard di tutorial
> ini menggunakan `! -o %i` yang otomatis benar di semua VPS, apapun nama interface-nya.
> `%i` adalah variabel wg-quick yang berisi nama interface WireGuard (contoh: `wg0`).

---

## Langkah 4: Aktifkan IP Forwarding

IP Forwarding memungkinkan VPS A meneruskan paket dari tunnel ke internet (dan sebaliknya).

```bash
cat > /etc/sysctl.d/99-wireguard.conf << 'EOF'
net.ipv4.ip_forward = 1
EOF

sysctl --system
```

### Verifikasi

```bash
sysctl net.ipv4.ip_forward
# Output HARUS: net.ipv4.ip_forward = 1
```

### What If: `sysctl --system` tidak mengubah nilai?

```bash
# Cek apakah ada file lain yang override:
grep -r "ip_forward" /etc/sysctl.d/ /etc/sysctl.conf
# Hapus atau edit file yang set ip_forward = 0

# Force apply langsung:
echo 1 > /proc/sys/net/ipv4/ip_forward
```

### Mengapa IP Forwarding?

Tanpa IP forwarding, paket dari VPS B yang sampai di wg0 VPS A akan di-DROP oleh kernel. Kernel hanya memproses paket untuk IP-nya sendiri (10.0.0.1), bukan paket yang ditujukan ke internet. Dengan `ip_forward = 1`, kernel mau meneruskan paket yang bukan untuknya.

---

## Langkah 5: Konfigurasi WireGuard Server

```bash
cat > /etc/wireguard/wg0.conf << 'EOF'
[Interface]
PrivateKey = GANTI_DENGAN_SERVER_PRIVATE_KEY
Address = 10.0.0.1/24
ListenPort = 51820

# ─── NAT Masquerade ──────────────────────────────────────────
# Traffic dari subnet tunnel (10.0.0.0/24) yang keluar ke internet
# akan di-NAT menjadi IP Public VPS A.
#
# "! -o %i" artinya: traffic yang TIDAK keluar via wg0 (= keluar via eth0/ens3/dll)
# %i otomatis diganti oleh wg-quick dengan nama interface WireGuard (wg0)
# Ini PORTABLE — bekerja di semua VPS tanpa hardcode nama interface
PostUp  = iptables -t nat -A POSTROUTING -s 10.0.0.0/24 ! -o %i -j MASQUERADE
PostUp  = iptables -A FORWARD -i %i -j ACCEPT
PostUp  = iptables -A FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -s 10.0.0.0/24 ! -o %i -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT
PostDown = iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# ─── Client Peers ─────────────────────────────────────────────
# Satu blok [Peer] per client. Alokasi IP:
#   10.0.0.1   = VPS A (server ini)
#   10.0.0.2   = VPS B
#   10.0.0.3   = VPS C
#   10.0.0.4   = (client berikutnya)
#   ... hingga 10.0.0.254

[Peer]
# VPS B
PublicKey = GANTI_DENGAN_PUBLIC_KEY_VPS_B
AllowedIPs = 10.0.0.2/32

[Peer]
# VPS C
PublicKey = GANTI_DENGAN_PUBLIC_KEY_VPS_C
AllowedIPs = 10.0.0.3/32
EOF
```

### Ganti Placeholder

| Placeholder | Ganti dengan | Cara mendapatkan |
|-------------|-------------|------------------|
| `GANTI_DENGAN_SERVER_PRIVATE_KEY` | Isi `/etc/wireguard/server.key` | `cat /etc/wireguard/server.key` |
| `GANTI_DENGAN_PUBLIC_KEY_VPS_B` | Public Key VPS B | Dibuat saat setup VPS B |
| `GANTI_DENGAN_PUBLIC_KEY_VPS_C` | Public Key VPS C | Dibuat saat setup VPS C |

### Set Permission

```bash
chmod 600 /etc/wireguard/wg0.conf
```

### Penjelasan Setiap Rule iptables

| Rule | Chain | Fungsi |
|------|-------|--------|
| `POSTROUTING -s 10.0.0.0/24 ! -o %i -j MASQUERADE` | nat | Ganti IP sumber 10.0.0.x → IP Public VPS A untuk traffic yang keluar ke internet |
| `FORWARD -i %i -j ACCEPT` | filter | Izinkan traffic MASUK dari tunnel diteruskan ke internet |
| `FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT` | filter | Izinkan traffic BALASAN dari internet kembali ke tunnel |

### Mengapa AllowedIPs Peer Pakai /32?

Di sisi **server**, `AllowedIPs` berfungsi sebagai **ACL (Access Control List)**:
- `/32` = peer ini hanya boleh mengklaim **satu IP** (IP tunnel-nya sendiri)
- Mencegah peer menyamar sebagai peer lain
- Contoh: VPS B hanya boleh mengirim paket dengan source 10.0.0.2

Di sisi **client**, `AllowedIPs = 0.0.0.0/0` berarti "kirim SEMUA traffic ke peer ini" — ini untuk full tunnel.

### What If: Saya belum punya Public Key client saat setup host?

Anda bisa setup host tanpa blok `[Peer]` dulu:

```bash
# 1. Buat config host tanpa peer (hanya [Interface])
# 2. Jalankan WireGuard: wg-quick up wg0
# 3. Nanti setelah client ready, tambahkan peer:
wg set wg0 peer <PUBLIC_KEY_CLIENT> allowed-ips 10.0.0.2/32
# 4. Simpan ke file config:
#    Edit /etc/wireguard/wg0.conf → tambah blok [Peer]
```

---

## Langkah 6: Jalankan WireGuard

```bash
wg-quick up wg0
```

### Output yang diharapkan

```
[#] ip link add wg0 type wireguard
[#] wg setconf wg0 /dev/fd/63
[#] ip -4 address add 10.0.0.1/24 dev wg0
[#] ip link set mtu 1420 up dev wg0
[#] iptables -t nat -A POSTROUTING -s 10.0.0.0/24 ! -o wg0 -j MASQUERADE
[#] iptables -A FORWARD -i wg0 -j ACCEPT
[#] iptables -A FORWARD -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

### Verifikasi

```bash
# 1. Status WireGuard
wg show

# 2. Interface wg0 aktif dengan IP 10.0.0.1/24
ip addr show wg0

# 3. NAT rule terpasang
iptables -t nat -L POSTROUTING -n -v | grep MASQUERADE

# 4. FORWARD rules terpasang
iptables -L FORWARD -n -v | grep wg0
```

### Enable Auto-Start

```bash
systemctl enable wg-quick@wg0
```

> Detail lengkap tentang otomasi ada di [04 — Otomasi & Monitoring](04-otomasi-dan-monitoring.md).

### What If: `wg-quick up wg0` error?

**Error: `RTNETLINK answers: Operation not supported`**
```bash
# WireGuard kernel module belum dimuat
modprobe wireguard
# Jika gagal: kernel terlalu lama, perlu install wireguard-dkms
```

**Error: `iptables: No chain/target/match by that name`**
```bash
# iptables modules belum dimuat
modprobe iptable_nat
modprobe iptable_filter
apt install -y iptables
```

**Error: `Address already in use`**
```bash
# wg0 sudah ada dari percobaan sebelumnya
wg-quick down wg0
wg-quick up wg0
```

---

## Langkah 7: Firewall

Port **51820/UDP** HARUS terbuka agar client bisa connect.

### Menggunakan UFW

```bash
ufw allow 51820/udp comment "WireGuard"
ufw allow OpenSSH
ufw enable
```

### Menggunakan iptables langsung

```bash
iptables -A INPUT -p udp --dport 51820 -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
```

### Menggunakan firewall provider (dashboard VPS)

Beberapa provider VPS memiliki firewall di level network (di luar VPS). Pastikan:
- Port **51820/UDP** → Allow
- Port **22/TCP** → Allow (SSH)

### What If: Client tidak bisa connect padahal config sudah benar?

```bash
# 1. Cek port terbuka dari sisi host
ss -ulnp | grep 51820
# Harus ada: udp UNCONN 0 0 0.0.0.0:51820

# 2. Cek firewall
iptables -L INPUT -n | grep 51820
ufw status | grep 51820

# 3. Test dari client (sebelum WireGuard aktif)
nc -uzv <IP_HOST> 51820

# 4. Cek firewall provider (dashboard VPS)
# Beberapa provider block UDP by default
```

---

## Langkah 8: Verifikasi

Setelah WireGuard berjalan, pastikan semua komponen aktif:

```bash
# 1. WireGuard running
wg show
```

Output yang diharapkan:
```
interface: wg0
  public key: <server_public_key>
  private key: (hidden)
  listening port: 51820

peer: <vps_b_public_key>
  allowed ips: 10.0.0.2/32

peer: <vps_c_public_key>
  allowed ips: 10.0.0.3/32
```

```bash
# 2. Interface wg0 ada
ip addr show wg0
```

```bash
# 3. IP forwarding aktif
sysctl net.ipv4.ip_forward
# Output: net.ipv4.ip_forward = 1
```

```bash
# 4. NAT Masquerade aktif
iptables -t nat -L POSTROUTING -n -v
# Harus ada: MASQUERADE all -- 10.0.0.0/24 0.0.0.0/0
```

```bash
# 5. Port listening
LISTEN_PORT=$(wg show wg0 listen-port)
ss -H -uln | grep ":${LISTEN_PORT}"
# Harus ada baris UDP untuk listen-port WireGuard (default biasanya 51820)
```

```bash
# 6. SSH ke VPS A masih bisa (test dari luar)
ssh root@<IP_HOST>
```

> **Catatan:** Peers belum akan menampilkan `latest handshake` sampai client benar-benar
> terhubung. Ini normal — handshake baru terjadi saat client `wg-quick up`.

---

## Menambah Client Baru

### Cara 1: Tanpa restart WireGuard (recommended)

```bash
# 1. Tentukan IP tunnel baru (urutan: 10.0.0.4, 10.0.0.5, ...)
# 2. Dapatkan Public Key dari client baru
# 3. Tambahkan peer secara live:
wg set wg0 peer <PUBLIC_KEY_BARU> allowed-ips 10.0.0.4/32

# 4. PENTING: Simpan ke config agar persist setelah reboot
#    Edit file config secara manual:
nano /etc/wireguard/wg0.conf
```

Tambahkan blok berikut di akhir file:

```ini
[Peer]
# VPS D (client baru)
PublicKey = <PUBLIC_KEY_BARU>
AllowedIPs = 10.0.0.4/32
```

> ⚠️ **Jangan gunakan `wg showconf wg0 > /etc/wireguard/wg0.conf`!**
> Perintah ini akan menghapus baris `PostUp`/`PostDown` dari config.
> Selalu edit manual jika config Anda menggunakan PostUp/PostDown.

### Cara 2: Dengan restart (jika perlu)

```bash
wg-quick down wg0
nano /etc/wireguard/wg0.conf    # Tambahkan blok [Peer] baru
wg-quick up wg0
```

---

## Menghapus Client

### Cara 1: Tanpa restart

```bash
# 1. Hapus peer secara live
wg set wg0 peer <PUBLIC_KEY_YANG_DIHAPUS> remove

# 2. Hapus juga dari config file
nano /etc/wireguard/wg0.conf    # Hapus blok [Peer] yang sesuai
```

### Cara 2: Dengan restart

```bash
wg-quick down wg0
nano /etc/wireguard/wg0.conf    # Hapus blok [Peer]
wg-quick up wg0
```

---

## Skalabilitas

### Kapasitas Subnet

| Subnet | Jumlah Client Maks | Cocok Untuk |
|--------|-------------------|-------------|
| `10.0.0.0/24` | 253 (10.0.0.2 – 10.0.0.254) | Kebanyakan kasus |
| `10.0.0.0/16` | 65.533 | Skala besar |

### Beberapa VPS Host

Jika punya beberapa VPS Host, gunakan subnet berbeda:

| Host | Subnet Tunnel | Address Server | ListenPort |
|------|--------------|----------------|------------|
| VPS A | `10.0.1.0/24` | `10.0.1.1/24` | 51820 |
| VPS D (host 2) | `10.0.2.0/24` | `10.0.2.1/24` | 51820 |
| VPS E (host 3) | `10.0.3.0/24` | `10.0.3.1/24` | 51820 |

Setiap host punya config WireGuard sendiri. Client tinggal ganti `Endpoint` dan `PublicKey` untuk pindah host.

---

## Checklist

Sebelum lanjut ke setup client, pastikan semua ✅:

- [ ] `wg show` — menampilkan peers yang terdaftar
- [ ] `ip addr show wg0` — menampilkan `10.0.0.1/24`
- [ ] `sysctl net.ipv4.ip_forward` — output `= 1`
- [ ] `iptables -t nat -L -n` — ada MASQUERADE untuk `10.0.0.0/24`
- [ ] `ss -ulnp | grep 51820` — port listening
- [ ] SSH ke VPS A masih bisa dari luar
- [ ] `systemctl is-enabled wg-quick@wg0` — output `enabled`

---

**Sebelumnya:** [01 — Konsep & Arsitektur](01-konsep-dan-arsitektur.md)
**Selanjutnya:** [03 — Setup Client (VPS B/C)](03-setup-client.md)

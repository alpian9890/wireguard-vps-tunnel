# 03 — Setup Client (VPS B/C) — Full Tunnel via VPS Host

## Daftar Isi

- [Tujuan](#tujuan)
- [Cara Kerja (Ringkas)](#cara-kerja-ringkas)
- [Contoh IP](#contoh-ip)
- [Langkah 1: Install WireGuard + Dependensi](#langkah-1-install-wireguard--dependensi)
- [Langkah 2: Generate Key Pair](#langkah-2-generate-key-pair)
- [Langkah 3: Daftarkan Client di VPS Host](#langkah-3-daftarkan-client-di-vps-host)
- [Langkah 4: Deploy Script Routing](#langkah-4-deploy-script-routing)
- [Langkah 5: Konfigurasi WireGuard Client](#langkah-5-konfigurasi-wireguard-client)
- [Langkah 6: Jalankan & Verifikasi](#langkah-6-jalankan--verifikasi)
- [Langkah 7: Setup ProxyJump SSH (di Laptop)](#langkah-7-setup-proxyjump-ssh-di-laptop)
- [Langkah 8: Disable IPv6 (Rekomendasi)](#langkah-8-disable-ipv6-rekomendasi)
- [Setup Client Tambahan](#setup-client-tambahan)
- [Pindah ke Host Berbeda](#pindah-ke-host-berbeda)
- [Checklist](#checklist)

---

## Tujuan

Setelah tutorial ini selesai:

1. ✅ `curl -4 ifconfig.me` di VPS Client → menampilkan **IP VPS Host**
2. ✅ SSH langsung ke IP asli VPS Client → **tetap bisa** (CONNMARK)
3. ✅ SSH via ProxyJump VPS Host → **bisa** (jalur alternatif)

---

## Cara Kerja (Ringkas)

```
Traffic Internet:
  VPS B → wg0 (tunnel) → VPS A → NAT → Internet
  Internet melihat: IP VPS A ✓

SSH Masuk ke VPS B:
  Laptop → eth0 VPS B → CONNMARK tandai koneksi
  Reply SSH → CONNMARK restore mark → keluar via eth0 (bukan tunnel) ✓
```

> Penjelasan detail ada di [01 — Konsep & Arsitektur](01-konsep-dan-arsitektur.md).

---

## Contoh IP

| Parameter | Contoh Nilai |
|-----------|-------------|
| IP Public VPS Host | `203.0.113.10` |
| IP Public VPS B | `198.51.100.20` |
| IP Tunnel VPS Host | `10.0.0.1` |
| IP Tunnel VPS B | `10.0.0.2` |
| IP Tunnel VPS C | `10.0.0.3` |

> ⚠️ **Ganti semua contoh IP dengan IP asli VPS Anda.**

---

## Langkah 1: Install WireGuard + Dependensi

```bash
apt update && apt install -y wireguard iptables iproute2 resolvconf
```

### Mengapa `resolvconf`?

`wg-quick` menggunakan `resolvconf` untuk mengelola DNS saat tunnel aktif. **Tanpa `resolvconf`, `wg-quick` akan GAGAL dan ROLLBACK semua perubahan** — termasuk interface yang baru dibuat.

### What If: `resolvconf` tidak tersedia?

```bash
# Alternatif 1: install dari backports
apt install -y resolvconf

# Alternatif 2: symlink ke systemd-resolved (jika ada)
ln -sf /usr/bin/resolvectl /usr/local/bin/resolvconf

# Alternatif 3: hapus baris DNS dari wg0.conf
# (DNS akan tetap menggunakan /etc/resolv.conf yang ada)
# Hapus baris: DNS = 1.1.1.1, 8.8.8.8
```

> **Pelajaran dari deployment nyata:**
> Saat pertama kali menjalankan `wg-quick up wg0` di VPS B, command gagal dengan error:
> ```
> resolvconf: command not found
> ```
> wg-quick otomatis rollback — interface wg0 yang baru dibuat langsung dihapus.
> Setelah install `resolvconf`, `wg-quick up` berjalan normal.

### Verifikasi

```bash
wg --version
which resolvconf    # Harus menampilkan path, misal /usr/sbin/resolvconf
```

---

## Langkah 2: Generate Key Pair

```bash
umask 077
wg genkey | tee /etc/wireguard/client.key | wg pubkey > /etc/wireguard/client.pub
chmod 600 /etc/wireguard/client.key
```

### Lihat Public Key

```bash
cat /etc/wireguard/client.pub
```

> 📋 **Catat Public Key ini** — harus didaftarkan di VPS Host sebagai peer.

---

## Langkah 3: Daftarkan Client di VPS Host

**Jalankan perintah ini di VPS Host (VPS A):**

### Cara 1: Tanpa restart (recommended)

```bash
# Di VPS A:
wg set wg0 peer <PUBLIC_KEY_VPS_B> allowed-ips 10.0.0.2/32
```

Lalu tambahkan juga ke file config agar persist:

```bash
# Di VPS A:
nano /etc/wireguard/wg0.conf
# Tambahkan di akhir:
# [Peer]
# # VPS B
# PublicKey = <PUBLIC_KEY_VPS_B>
# AllowedIPs = 10.0.0.2/32
```

### Cara 2: Dengan restart

```bash
# Di VPS A:
wg-quick down wg0
nano /etc/wireguard/wg0.conf    # Tambahkan blok [Peer]
wg-quick up wg0
```

### Verifikasi (di VPS A)

```bash
wg show wg0 peers
# Harus menampilkan public key VPS B
```

---

## Langkah 4: Deploy Script Routing

Dua script ini mengatur routing agar:
- Semua traffic internet keluar via tunnel (IP tersembunyi)
- Koneksi masuk (SSH, dll) dibalas via interface fisik (akses tetap bisa)

Script ada di folder `scripts/` repository ini:
- [`tunnel-up.sh`](../scripts/tunnel-up.sh) — aktifkan routing tunnel + CONNMARK
- [`tunnel-down.sh`](../scripts/tunnel-down.sh) — kembalikan routing ke normal

### Deploy ke VPS Client

```bash
# Cara 1: Copy dari repository (jika sudah clone)
cp scripts/tunnel-up.sh /etc/wireguard/tunnel-up.sh
cp scripts/tunnel-down.sh /etc/wireguard/tunnel-down.sh
chmod +x /etc/wireguard/tunnel-up.sh /etc/wireguard/tunnel-down.sh
```

```bash
# Cara 2: Download langsung dari GitHub
# (ganti URL sesuai repository Anda)
curl -o /etc/wireguard/tunnel-up.sh https://raw.githubusercontent.com/<USER>/<REPO>/main/scripts/tunnel-up.sh
curl -o /etc/wireguard/tunnel-down.sh https://raw.githubusercontent.com/<USER>/<REPO>/main/scripts/tunnel-down.sh
chmod +x /etc/wireguard/tunnel-up.sh /etc/wireguard/tunnel-down.sh
```

```bash
# Cara 3: Buat manual (copy-paste dari scripts/tunnel-up.sh dan scripts/tunnel-down.sh)
nano /etc/wireguard/tunnel-up.sh     # Paste isi tunnel-up.sh
nano /etc/wireguard/tunnel-down.sh   # Paste isi tunnel-down.sh
chmod +x /etc/wireguard/tunnel-up.sh /etc/wireguard/tunnel-down.sh
```

### Verifikasi script ada dan executable

```bash
ls -la /etc/wireguard/tunnel-*.sh
# Harus: -rwx------ atau -rwxr-xr-x
```

### Penjelasan Singkat Script

**tunnel-up.sh** (dipanggil saat WireGuard naik):
1. Deteksi default gateway dan interface fisik
2. Simpan state ke `/run/wg-tunnel-wg0.state`
3. Tambah bypass route untuk IP VPS Host (cegah routing loop)
4. **CONNMARK + policy routing** (SEBELUM ganti route!) ← KRITIS
5. Sleep 1 detik (beri waktu SSH ter-mark)
6. Ganti default route ke tunnel

**tunnel-down.sh** (dipanggil saat WireGuard turun):
1. Baca state yang disimpan
2. Hapus CONNMARK rules
3. Hapus policy routing
4. Hapus bypass route
5. Kembalikan default route ke gateway fisik

> **PENTING tentang urutan di tunnel-up.sh:**
> CONNMARK dan policy routing HARUS dipasang SEBELUM default route diubah.
> Jika urutannya terbalik, koneksi SSH yang sedang aktif akan putus karena
> reply SSH masuk ke tunnel sebelum CONNMARK sempat melindunginya.
>
> Pelajaran dari deployment nyata: Script versi awal memiliki urutan terbalik.
> Saat dijalankan, SSH session langsung hang. Setelah memperbaiki urutan
> (CONNMARK dulu, route terakhir), SSH tetap connected saat tunnel dinyalakan.

---

## Langkah 5: Konfigurasi WireGuard Client

```bash
cat > /etc/wireguard/wg0.conf << 'EOF'
[Interface]
PrivateKey = GANTI_DENGAN_CLIENT_PRIVATE_KEY
Address = 10.0.0.2/32
DNS = 1.1.1.1, 8.8.8.8

# Table = off → nonaktifkan auto-routing wg-quick
# Kita atur routing sendiri via script untuk kontrol penuh
Table = off

# PostUp: setelah interface aktif, atur routing tunnel + CONNMARK
PostUp  = /etc/wireguard/tunnel-up.sh %i
# PreDown: sebelum interface dihapus, kembalikan routing ke normal
PreDown = /etc/wireguard/tunnel-down.sh %i

[Peer]
PublicKey = GANTI_DENGAN_PUBLIC_KEY_VPS_HOST
Endpoint = 203.0.113.10:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF
```

### Ganti Placeholder

| Placeholder | Ganti dengan | Cara mendapatkan |
|-------------|-------------|------------------|
| `GANTI_DENGAN_CLIENT_PRIVATE_KEY` | Private Key VPS B | `cat /etc/wireguard/client.key` |
| `GANTI_DENGAN_PUBLIC_KEY_VPS_HOST` | Public Key VPS A | `cat /etc/wireguard/server.pub` (di VPS A) |
| `203.0.113.10` | IP Public VPS A | `curl -4 ifconfig.me` (di VPS A) |
| `10.0.0.2/32` | IP tunnel VPS B | VPS C pakai `10.0.0.3/32`, dst |

### Set Permission

```bash
chmod 600 /etc/wireguard/wg0.conf
```

### Penjelasan Setiap Baris

| Baris | Fungsi |
|-------|--------|
| `PrivateKey` | Identitas kriptografi VPS B |
| `Address = 10.0.0.2/32` | IP VPS B di dalam tunnel |
| `DNS = 1.1.1.1, 8.8.8.8` | DNS resolver (query DNS juga lewat tunnel) |
| `Table = off` | wg-quick TIDAK atur routing → script yang handle |
| `PostUp = .../tunnel-up.sh %i` | Jalankan script setelah interface naik |
| `PreDown = .../tunnel-down.sh %i` | Jalankan script sebelum interface turun |
| `PublicKey` | Public key VPS Host (untuk verifikasi) |
| `Endpoint = IP:port` | Alamat VPS Host yang dituju |
| `AllowedIPs = 0.0.0.0/0` | Terima SEMUA traffic dari peer (full tunnel) |
| `PersistentKeepalive = 25` | Kirim keepalive tiap 25 detik agar tunnel tetap hidup |

### What If: Endpoint menggunakan IP contoh (203.0.113.10)?

> **Pelajaran dari deployment nyata:**
> VPS B awalnya tidak bisa connect karena Endpoint masih berisi IP contoh
> dari tutorial (`203.0.113.10`) bukan IP asli VPS Host (`103.253.212.145`).
> WireGuard tidak memberikan error yang jelas — hanya tidak ada handshake.

**Cara cek dan fix:**
```bash
grep Endpoint /etc/wireguard/wg0.conf
# Pastikan ini IP ASLI VPS Host, bukan IP contoh!

# Jika salah, fix:
sed -i 's/203.0.113.10/IP_ASLI_VPS_HOST/g' /etc/wireguard/wg0.conf
```

---

## Langkah 6: Jalankan & Verifikasi

### ⚠️ PENTING: Sebelum Menjalankan

1. **Pastikan Anda punya akses alternatif** ke VPS Client:
   - VNC/Console dari dashboard provider VPS
   - Ini sebagai "pintu darurat" jika SSH terputus

2. **Pastikan Endpoint sudah benar** (IP asli VPS Host, bukan contoh)

3. **Pastikan VPS Host sudah berjalan** (`wg show` di VPS A menampilkan peer)

### 6a. Aktifkan Tunnel

```bash
wg-quick up wg0
```

Output yang diharapkan:

```
[#] ip link add wg0 type wireguard
[#] wg setconf wg0 /dev/fd/63
[#] ip -4 address add 10.0.0.2/32 dev wg0
[#] ip link set mtu 1420 up dev wg0
[#] resolvconf -a wg0 -m 0 -x
[#] /etc/wireguard/tunnel-up.sh wg0

  → Gateway: 202.155.94.1 via eth0
  → Endpoint VPS A: 103.253.212.145

  ✓ Bypass route: 103.253.212.145 → langsung via eth0
  ✓ CONNMARK aktif: reply koneksi masuk → via eth0
  ✓ Default route → wg0 (semua traffic via tunnel)

════════════════════════════════════════════════════
  ✓ Tunnel AKTIF
  ✓ Traffic internet → via wg0 (IP VPS A)
  ✓ SSH langsung ke IP asli → tetap bisa (CONNMARK)
  ✓ SSH via ProxyJump VPS A → tetap bisa
════════════════════════════════════════════════════
```

### 6b. Test IP

```bash
curl -4 ifconfig.me
```

**Harus menampilkan IP VPS Host** (contoh: `103.253.212.145`), **bukan** IP asli VPS B.

### 6c. Test SSH Jalur 1 — Langsung ke IP Asli

Dari laptop/PC lain:

```bash
ssh root@198.51.100.20    # IP asli VPS B
```

**Harus tetap bisa** walaupun tunnel aktif. Ini berkat CONNMARK.

### 6d. Test SSH Jalur 2 — ProxyJump via VPS Host

Dari laptop/PC lain:

```bash
ssh -J root@203.0.113.10 root@10.0.0.2    # via VPS Host → IP tunnel VPS B
```

**Harus bisa.** SSH masuk ke VPS Host dulu, lalu lanjut ke VPS B via jaringan tunnel.

### 6e. Test WireGuard Status

```bash
wg show
```

Pastikan ada `latest handshake` yang baru (dalam beberapa detik terakhir).

### 6f. Test Routing

```bash
# Default route harus via wg0
ip route show default
# Output: default dev wg0 scope link

# Bypass route untuk VPS Host
ip route show | grep <IP_HOST>
# Output: <IP_HOST> via <gateway> dev eth0

# CONNMARK rules
iptables -t mangle -L PREROUTING -n -v | grep CONNMARK
iptables -t mangle -L OUTPUT -n -v | grep "0xc8"

# Policy routing
ip rule show | grep "fwmark 0xc8"
# Output: 100: from all fwmark 0xc8 lookup 200

# Routing table 200
ip route show table 200
# Output: default via <gateway> dev eth0
```

### What If: `curl -4 ifconfig.me` masih menampilkan IP asli?

```bash
# 1. Cek default route
ip route show default
# Jika BUKAN "default dev wg0" → tunnel-up.sh tidak berjalan

# 2. Cek apakah tunnel-up.sh dijalankan
cat /run/wg-tunnel-wg0.state
# Jika file tidak ada → script tidak berjalan

# 3. Cek WireGuard handshake
wg show
# Jika tidak ada "latest handshake" → tunnel belum established

# 4. Restart tunnel
wg-quick down wg0 && wg-quick up wg0
```

### What If: SSH session hang saat `wg-quick up`?

> **Ini terjadi pada deployment nyata kami dengan script versi awal.**
>
> **Penyebab:** Default route diubah ke wg0 SEBELUM CONNMARK dipasang.
> Solusi: Pastikan tunnel-up.sh menggunakan urutan yang benar
> (CONNMARK dulu, route terakhir). Lihat script di `scripts/tunnel-up.sh`.

Jika sudah terlanjur hang:
1. Tunggu 30-60 detik — kadang koneksi bisa pulih sendiri setelah CONNMARK aktif
2. Jika tetap hang, masuk via **VNC/Console** dari dashboard provider
3. Di VNC, jalankan:
   ```bash
   wg-quick down wg0
   ```
4. Periksa dan update script `tunnel-up.sh` ke versi yang benar
5. Coba lagi

### What If: `wg-quick up wg0` error "resolvconf: command not found"?

```bash
# Install resolvconf
apt install -y resolvconf

# Coba lagi
wg-quick up wg0
```

> wg-quick akan otomatis rollback semua perubahan jika resolvconf gagal.
> Setelah install resolvconf, jalankan ulang `wg-quick up wg0`.

### 6g. Matikan Tunnel (jika perlu)

```bash
wg-quick down wg0
```

Setelah dimatikan, `curl -4 ifconfig.me` kembali menampilkan IP asli VPS B.

---

## Langkah 7: Setup ProxyJump SSH (di Laptop)

Buat config SSH di **laptop/PC lokal** agar ProxyJump lebih praktis:

```bash
# Di laptop lokal, buat/edit ~/.ssh/config
cat >> ~/.ssh/config << 'EOF'

Host vps-host
    HostName 203.0.113.10
    User root

Host vps-b
    HostName 10.0.0.2
    User root
    ProxyJump vps-host

Host vps-c
    HostName 10.0.0.3
    User root
    ProxyJump vps-host
EOF
```

Sekarang cukup:

```bash
ssh vps-host    # langsung ke VPS Host
ssh vps-b       # otomatis lewat VPS Host → ke VPS B (via tunnel)
ssh vps-c       # otomatis lewat VPS Host → ke VPS C (via tunnel)
```

> 💡 Anda tetap bisa SSH langsung: `ssh root@198.51.100.20` (IP asli VPS B).
> ProxyJump adalah **opsi tambahan**, bukan satu-satunya cara.

---

## Langkah 8: Disable IPv6 (Rekomendasi)

Tutorial ini fokus pada IPv4 tunnel. Jika VPS Client memiliki IPv6, koneksi IPv6 **TIDAK** melewati tunnel — artinya situs yang menggunakan IPv6 bisa melihat IPv6 asli VPS Client.

### Cek apakah VPS punya IPv6

```bash
ip -6 addr show scope global
# Jika ada output → VPS punya IPv6 publik → potensi kebocoran
```

### Disable IPv6

```bash
cat > /etc/sysctl.d/99-disable-ipv6.conf << 'EOF'
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
EOF

sysctl --system
```

### Verifikasi

```bash
curl -6 ifconfig.me 2>&1
# Harus error: "Could not resolve host" atau "Network is unreachable"
```

### What If: Saya butuh IPv6?

Jika Anda memerlukan IPv6, Anda bisa tunnel IPv6 juga:
1. Tambahkan alamat IPv6 di WireGuard config (Address, AllowedIPs)
2. Konfigurasi NAT66 atau NPTv6 di VPS Host
3. Ini lebih kompleks — lihat [Skenario Lanjutan](06-skenario-lanjutan.md)

---

## Setup Client Tambahan

Untuk VPS C, D, dst — langkahnya **identik** dengan VPS B. Yang berbeda hanya:

| Parameter | VPS B | VPS C | VPS D |
|-----------|-------|-------|-------|
| IP Tunnel | `10.0.0.2/32` | `10.0.0.3/32` | `10.0.0.4/32` |
| Key Pair | Milik VPS B | Milik VPS C | Milik VPS D |

### Langkah Ringkas untuk Client Baru

```bash
# ─── 1. Install ──────────────────────────────────────────────
apt update && apt install -y wireguard iptables iproute2 resolvconf

# ─── 2. Generate key pair ────────────────────────────────────
umask 077
wg genkey | tee /etc/wireguard/client.key | wg pubkey > /etc/wireguard/client.pub
cat /etc/wireguard/client.pub    # → kirim ke VPS Host

# ─── 3. Di VPS Host: daftarkan peer ──────────────────────────
# wg set wg0 peer <PUBLIC_KEY> allowed-ips 10.0.0.X/32
# (tambahkan juga ke wg0.conf agar persist)

# ─── 4. Deploy script routing ────────────────────────────────
# Copy tunnel-up.sh dan tunnel-down.sh ke /etc/wireguard/
# chmod +x

# ─── 5. Buat config WireGuard ────────────────────────────────
# Copy template wg0.conf, ganti: PrivateKey, Address, PublicKey, Endpoint

# ─── 6. Test ─────────────────────────────────────────────────
wg-quick up wg0
curl -4 ifconfig.me    # → IP VPS Host?
# SSH dari luar ke IP asli → masih bisa?
# SSH via ProxyJump → bisa?

# ─── 7. Auto-start ───────────────────────────────────────────
systemctl enable wg-quick@wg0
```

> **Script `tunnel-up.sh` dan `tunnel-down.sh` IDENTIK di semua client.**
> Tidak perlu diedit. Script otomatis mendeteksi gateway, interface, dan
> endpoint dari config WireGuard.

---

## Pindah ke Host Berbeda

Jika punya beberapa VPS Host dan ingin client pindah:

### Opsi A: Ganti Config

```bash
wg-quick down wg0
nano /etc/wireguard/wg0.conf    # Ganti Endpoint + PublicKey
wg-quick up wg0
```

### Opsi B: Config Terpisah per Host

```
/etc/wireguard/via-host-a.conf    → tunnel ke VPS A
/etc/wireguard/via-host-d.conf    → tunnel ke VPS D (host kedua)
```

```bash
wg-quick up via-host-a      # Gunakan IP VPS A
# atau
wg-quick down via-host-a && wg-quick up via-host-d    # Pindah ke VPS D
```

> ⚠️ **Hanya aktifkan SATU config tunnel pada satu waktu.**
> Menjalankan dua tunnel bersamaan akan menyebabkan konflik routing.

### What If: Saya aktifkan dua tunnel sekaligus?

```bash
# Jika tidak sengaja aktifkan dua tunnel:
wg-quick down via-host-a
wg-quick down via-host-d

# Bersihkan routing yang kacau:
ip route flush table 200
ip rule del fwmark 200 table 200 2>/dev/null
# Restart tunnel yang diinginkan:
wg-quick up via-host-a
```

---

## Checklist

Sebelum lanjut ke otomasi, pastikan semua ✅:

- [ ] `wg show` — handshake dengan VPS Host ada (beberapa detik lalu)
- [ ] `curl -4 ifconfig.me` — menampilkan **IP VPS Host**
- [ ] `ssh root@<IP_ASLI_VPS_B>` dari luar — **bisa** (CONNMARK)
- [ ] `ssh -J root@<IP_HOST> root@10.0.0.2` — **bisa** (ProxyJump)
- [ ] `ip route show default` — `default dev wg0`
- [ ] `ip rule show` — ada `fwmark 0xc8 lookup 200`
- [ ] `ip route show table 200` — ada `default via <gateway> dev <interface>`
- [ ] `iptables -t mangle -L PREROUTING -n` — ada CONNMARK rule
- [ ] `iptables -t mangle -L OUTPUT -n` — ada MARK rule
- [ ] IPv6 disabled (atau Anda sadar ada potensi kebocoran)

---

**Sebelumnya:** [02 — Setup Host (VPS A)](02-setup-host.md)
**Selanjutnya:** [04 — Otomasi & Monitoring](04-otomasi-dan-monitoring.md)

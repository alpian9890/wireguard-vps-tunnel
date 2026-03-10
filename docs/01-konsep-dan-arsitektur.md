# 01 — Konsep & Arsitektur

## Daftar Isi

- [Latar Belakang & Tujuan](#latar-belakang--tujuan)
- [Mengapa WireGuard?](#mengapa-wireguard)
- [Perbandingan: Xray+tun2socks vs WireGuard](#perbandingan-xraytun2socks-vs-wireguard)
- [Arsitektur Jaringan](#arsitektur-jaringan)
- [Cara Kerja Full Tunnel](#cara-kerja-full-tunnel)
- [Masalah Klasik: SSH Putus saat Tunnel Aktif](#masalah-klasik-ssh-putus-saat-tunnel-aktif)
- [Solusi: CONNMARK](#solusi-connmark)
- [Penjelasan Detail CONNMARK](#penjelasan-detail-connmark)
- [Mengapa Table = off](#mengapa-table--off)
- [Mengapa Urutan Script Penting](#mengapa-urutan-script-penting)
- [ProxyJump: Jalur SSH Kedua](#proxyjump-jalur-ssh-kedua)
- [Ringkasan Komponen](#ringkasan-komponen)

---

## Latar Belakang & Tujuan

### Problem

Anda punya beberapa VPS, dan ingin **menyembunyikan IP Public** VPS Client. Semua traffic internet dari VPS Client harus keluar menggunakan IP VPS Host — seolah-olah VPS Client "meminjam" IP Public dari VPS Host.

```
Tanpa tunnel:
  VPS B $ curl ifconfig.me → 202.155.94.5     ← IP asli (terekspos)

Dengan tunnel:
  VPS B $ curl ifconfig.me → 103.253.212.145  ← IP VPS Host (tersembunyi)
```

### Goal

1. **IP Masking** — Semua traffic internet VPS Client keluar dengan IP VPS Host
2. **SSH Tetap Bisa** — Admin tetap bisa SSH ke VPS Client via IP asli kapan saja
3. **Otomatis** — Tunnel aktif saat boot, auto-recovery jika bermasalah
4. **Skalabel** — Mudah tambah client baru tanpa mengubah konfigurasi yang ada

---

## Mengapa WireGuard?

WireGuard dipilih karena:

| Aspek | WireGuard | OpenVPN | Xray+tun2socks |
|-------|-----------|---------|-----------------|
| Kecepatan | ⚡ Sangat cepat (kernel-level) | 🐌 Lambat (userspace) | 🐌 Lambat (2x userspace) |
| Konfigurasi | 📄 Minimal (< 20 baris) | 📚 Kompleks (100+ baris) | 📚 Kompleks (JSON + script) |
| Komponen | 1 (wireguard) | 1 (openvpn) | 3 (xray + tun2socks + script) |
| Overhead | ✅ Rendah (kernel module) | ❌ Tinggi (TLS + TAP) | ❌ Sangat tinggi (TLS + SOCKS + TUN) |
| Stabilitas | ✅ Stabil (bagian kernel Linux) | ✅ Stabil | ⚠️ Butuh babysitting |
| Keamanan | ✅ Modern crypto (ChaCha20) | ✅ OpenSSL | ✅ Reality/XTLS |
| Steganografi | ❌ Terdeteksi sebagai WireGuard | ❌ Terdeteksi | ✅ Bisa bypass DPI |

> **Catatan:** Jika ISP/provider Anda memblokir protokol WireGuard (UDP), lihat
> [Skenario Lanjutan: Provider Memblokir UDP](06-skenario-lanjutan.md#what-if-provider-memblokir-wireguard-udp).
> Dalam kasus tersebut, Xray+tun2socks mungkin lebih cocok karena bisa menyamar sebagai HTTPS.

---

## Perbandingan: Xray+tun2socks vs WireGuard

### Pendekatan Lama: Xray + tun2socks

```
VPS Client:
  Xray (VLESS client) → SOCKS5 proxy di 127.0.0.1:10808
  tun2socks → buat TUN interface, arahkan traffic ke SOCKS5
  iptables + ip rule → routing policy
```

**Masalah yang ditemukan:**
1. **SSH putus** saat tunnel aktif — script menggunakan MARK di PREROUTING tapi reply SSH keluar via OUTPUT chain (tidak pernah di-mark), sehingga reply SSH masuk ke tunnel
2. **3 komponen** harus berjalan bersamaan (Xray + tun2socks + routing script)
3. **Jika satu komponen crash**, seluruh tunnel bisa rusak dan routing kacau
4. **Workaround**: matikan tun2socks dulu → SSH → nyalakan tun2socks lagi (ribet!)

### Pendekatan Baru: WireGuard + CONNMARK

```
VPS Client:
  WireGuard (kernel module) → tunnel langsung ke VPS Host
  CONNMARK + ip rule → policy routing untuk proteksi SSH
```

**Keunggulan:**
1. **SSH tetap bisa** saat tunnel aktif — berkat CONNMARK yang benar
2. **1 komponen** saja (WireGuard, berjalan di kernel)
3. **Jika tunnel mati**, SSH tetap bisa (CONNMARK + policy routing independent)
4. **Kecepatan jauh lebih tinggi** — tidak ada overhead userspace proxy

---

## Arsitektur Jaringan

### Komponen

```
┌─────────────────────────────────────────────────────┐
│                      INTERNET                        │
│                                                      │
│  Situs web melihat IP → 103.253.212.145 (VPS Host) │
└───────┬──────────────────────┬──────────────────────┘
        │                      │
  ┌─────┴──────────┐    ┌─────┴──────────┐
  │   VPS A (Host)  │    │   VPS B (Client)│
  │                 │    │                 │
  │ IP: 103.253.    │    │ IP: 202.155.   │
  │     212.145     │    │     94.5       │
  │                 │    │                 │
  │ ┌─────────────┐ │    │ ┌─────────────┐ │
  │ │ wg0         │ │    │ │ wg0         │ │
  │ │ 10.0.0.1    │◄├────┼─┤ 10.0.0.2   │ │
  │ └─────────────┘ │    │ └─────────────┘ │
  │                 │    │                 │
  │ ┌─────────────┐ │    │ ┌─────────────┐ │
  │ │ NAT         │ │    │ │ CONNMARK    │ │
  │ │ Masquerade  │ │    │ │ Policy      │ │
  │ │ 10.0.0.x →  │ │    │ │ Routing     │ │
  │ │ IP Public   │ │    │ │             │ │
  │ └─────────────┘ │    │ └─────────────┘ │
  └────────────────┘    └────────────────┘
```

### Alur Traffic

#### Internet Traffic (IP tersembunyi)

```
VPS B: curl ifconfig.me
  │
  ├─ 1. Aplikasi membuat request HTTP
  │     src: 10.0.0.2  dst: ifconfig.me
  │
  ├─ 2. Kernel cek routing table → default dev wg0
  │     Paket masuk ke WireGuard tunnel
  │
  ├─ 3. WireGuard enkripsi → kirim via UDP ke VPS A
  │     src: 202.155.94.5:random  dst: 103.253.212.145:51820
  │     (paket WireGuard ke endpoint, lewat bypass route)
  │
  ├─ 4. VPS A terima, dekripsi → paket asli muncul di wg0
  │     src: 10.0.0.2  dst: ifconfig.me
  │
  ├─ 5. VPS A forward + NAT Masquerade
  │     src: 103.253.212.145  dst: ifconfig.me  ← IP berubah!
  │
  ├─ 6. Internet melihat request dari 103.253.212.145
  │     Response kembali ke VPS A
  │
  ├─ 7. VPS A terima response, reverse NAT → kirim ke wg0
  │     dst: 10.0.0.2
  │
  └─ 8. VPS B terima response via tunnel
        curl menampilkan: 103.253.212.145 ✓
```

#### SSH Masuk ke VPS Client (CONNMARK)

```
Admin laptop: ssh root@202.155.94.5
  │
  ├─ 1. Paket SSH SYN masuk ke VPS B via eth0
  │     src: laptop_ip  dst: 202.155.94.5:22
  │
  ├─ 2. PREROUTING chain (mangle table):
  │     "Paket masuk via eth0 → set CONNMARK = 200"
  │     Kernel menyimpan mark 200 di conntrack entry
  │
  ├─ 3. SSH server di VPS B terima dan proses request
  │
  ├─ 4. Kernel membuat paket reply (SYN-ACK)
  │     src: 202.155.94.5:22  dst: laptop_ip
  │
  ├─ 5. OUTPUT chain (mangle table):
  │     "Paket ini punya connmark 200 → restore ke packet mark"
  │     Kernel set fwmark = 200 pada paket reply
  │
  ├─ 6. Kernel cek ip rule:
  │     "fwmark 200 → lookup table 200"
  │
  ├─ 7. Table 200: default via gateway_fisik dev eth0
  │     Paket reply KELUAR VIA eth0 (bukan wg0!) ✓
  │
  └─ 8. Admin laptop terima reply → SSH session established ✓

TANPA CONNMARK:
  Langkah 4-5: tidak ada mark
  Langkah 6: paket ikut default route → masuk wg0 (TUNNEL)
  Langkah 7: reply SSH keluar via IP VPS Host → SALAH ALAMAT
  Admin laptop: "Connection timeout" ✗
```

---

## Masalah Klasik: SSH Putus saat Tunnel Aktif

### Akar Masalah

Ketika Anda mengubah default route ke tunnel (wg0), **SEMUA traffic keluar** termasuk reply SSH ikut masuk ke tunnel. Ini menyebabkan:

1. Admin SSH ke `202.155.94.5` (IP asli VPS B)
2. Paket SSH masuk via `eth0` → server SSH proses
3. Paket reply harus keluar → kernel cek default route → `default dev wg0`
4. Reply SSH keluar via tunnel → sampai di internet sebagai IP VPS Host
5. Laptop admin menunggu reply dari `202.155.94.5` tapi yang datang dari `103.253.212.145`
6. TCP stack laptop: "ini bukan dari server yang saya hubungi" → **DROP**
7. SSH timeout ✗

### Pendekatan Salah: MARK di PREROUTING Saja

```
# SALAH — hanya mark paket MASUK, tidak mark paket KELUAR (reply)
iptables -t mangle -A PREROUTING -i eth0 -j MARK --set-mark 200
```

Ini **tidak cukup** karena:
- MARK hanya berlaku pada paket itu sendiri (yang masuk)
- Paket reply (keluar) dibuat baru oleh kernel → tidak punya mark
- Reply tetap ikut default route (tunnel) → SSH putus

### Pendekatan Salah: MARK dengan `--ctstate NEW`

```
# SALAH — hanya mark koneksi BARU, koneksi SSH yang sudah ada tidak ter-mark
iptables -t mangle -A PREROUTING -i eth0 -m conntrack --ctstate NEW \
    -j CONNMARK --set-mark 200
```

Ini **berbahaya** karena:
- Saat script dijalankan, koneksi SSH yang sedang aktif sudah bukan "NEW"
- Koneksi SSH yang sedang aktif TIDAK akan di-mark
- Begitu default route berubah ke tunnel → SSH yang sedang aktif putus!

---

## Solusi: CONNMARK

CONNMARK berbeda dari MARK biasa:

| Fitur | MARK | CONNMARK |
|-------|------|----------|
| Scope | Per-paket | Per-koneksi (disimpan di conntrack) |
| Persist | Hilang setelah paket diproses | Tetap selama koneksi hidup |
| Reply | Reply tidak punya mark | Reply bisa restore mark dari conntrack |
| Chain | Harus di-set di setiap chain | Set sekali, restore di chain lain |

### Mekanisme

```
┌──────────────────── PREROUTING (mangle) ────────────────────┐
│                                                              │
│  if (paket masuk via eth0):                                  │
│      CONNMARK --set-mark 200                                 │
│      → kernel simpan mark 200 di conntrack entry             │
│      → SEMUA paket di koneksi ini (termasuk reply) punya     │
│        connmark 200                                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────── OUTPUT (mangle) ─────────────────────────┐
│                                                               │
│  if (paket punya connmark 200):                               │
│      MARK --set-mark 200                                      │
│      → copy connmark ke packet mark (fwmark)                  │
│      → sekarang ip rule bisa match paket ini                  │
│                                                               │
└───────────────────────────────────────────────────────────────┘

┌──────────────────── IP RULE + TABLE ──────────────────────────┐
│                                                                │
│  ip rule: fwmark 200 → lookup table 200                        │
│  table 200: default via gateway_fisik dev eth0                 │
│                                                                │
│  → paket reply keluar via eth0, BUKAN via tunnel ✓             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Penjelasan Detail CONNMARK

### Iptables Rules

```bash
# Rule 1: Di PREROUTING — tandai SEMUA paket masuk via interface fisik
iptables -t mangle -A PREROUTING -i "$DEF_IF" -j CONNMARK --set-mark 200
```

**Penjelasan:**
- `-t mangle`: table mangle (untuk memanipulasi paket/mark)
- `-A PREROUTING`: chain PREROUTING (paket masuk, sebelum routing decision)
- `-i "$DEF_IF"`: hanya paket yang masuk via interface fisik (eth0/ens3)
- `-j CONNMARK --set-mark 200`: simpan mark 200 di conntrack entry

**Kenapa tanpa `--ctstate NEW`?**
Karena kita ingin mark **SEMUA** paket — termasuk paket dari koneksi SSH yang sudah ada sebelum script dijalankan. Jika pakai `--ctstate NEW`, koneksi SSH yang sedang aktif tidak akan ter-mark dan akan putus saat default route berubah.

```bash
# Rule 2: Di OUTPUT — restore connmark ke packet mark untuk reply
iptables -t mangle -A OUTPUT -m connmark --mark 200 -j MARK --set-mark 200
```

**Penjelasan:**
- `-A OUTPUT`: chain OUTPUT (paket keluar yang dibuat oleh proses lokal)
- `-m connmark --mark 200`: match paket yang koneksinya punya connmark 200
- `-j MARK --set-mark 200`: set packet mark (fwmark) = 200

**Apa bedanya connmark dan mark?**
- `connmark`: atribut yang melekat pada **koneksi** (di conntrack table)
- `mark` (fwmark): atribut yang melekat pada **paket individual**
- `ip rule` hanya bisa match `fwmark`, bukan `connmark`
- Jadi kita perlu "copy" connmark → fwmark di OUTPUT chain

### Policy Routing

```bash
# IP rule: paket dengan fwmark 200 → gunakan routing table 200
ip rule add fwmark 200 table 200 priority 100

# Table 200: route default via gateway fisik
ip route replace default via <GATEWAY> dev <INTERFACE> table 200
```

**Penjelasan:**
- Priority 100 = lebih tinggi dari default (priority 32766)
- Table 200 = routing table terpisah, hanya untuk traffic yang di-mark
- Traffic yang di-mark keluar via gateway fisik, bukan via tunnel

### Analogi

Bayangkan VPS Client adalah sebuah gedung dengan dua pintu:
- **Pintu depan** (eth0) = koneksi langsung ke internet
- **Pintu belakang** (wg0) = tunnel ke VPS Host

CONNMARK seperti **sistem kartu pengunjung**:
1. Tamu masuk via pintu depan → diberi kartu "MASUK VIA DEPAN"
2. Tamu selesai urusan → petugas cek kartu → "Oh, Anda masuk via depan"
3. Tamu diarahkan keluar via pintu depan (bukan pintu belakang)

Tanpa kartu pengunjung, semua orang diarahkan ke pintu belakang (default route = tunnel), termasuk tamu yang harusnya keluar via pintu depan.

---

## Mengapa Table = off

WireGuard punya fitur auto-routing via `wg-quick`. Secara default, `wg-quick` akan:
1. Membuat interface wg0
2. **Otomatis** menambah routing rules dan default route
3. Menonaktifkan rules saat shutdown

Kita menggunakan `Table = off` karena:

| Aspek | Table = auto (default) | Table = off (kita pakai) |
|-------|----------------------|------------------------|
| Routing | wg-quick atur otomatis | Kita atur manual via script |
| CONNMARK | ❌ Tidak ada | ✅ Kita pasang sendiri |
| Urutan eksekusi | ❌ Tidak bisa dikontrol | ✅ Full control |
| SSH protection | ❌ Tidak ada | ✅ CONNMARK + policy routing |
| Debugging | Sulit (magic routing) | Mudah (eksplisit) |

Dengan `Table = off`, kita bisa:
1. Memasang CONNMARK **sebelum** mengubah default route
2. Mengontrol urutan eksekusi setiap langkah
3. Menyimpan state (gateway, interface) untuk cleanup yang bersih

---

## Mengapa Urutan Script Penting

### Urutan SALAH (SSH putus!)

```
1. ❌ Ganti default route ke tunnel     ← SSH reply langsung masuk tunnel
2. ❌ Pasang CONNMARK                    ← sudah terlambat!
3. ❌ Setup policy routing               ← sudah terlambat!

Timeline:
  t=0: SSH aktif, route normal
  t=1: route berubah ke wg0 → reply SSH ikut masuk tunnel → PUTUS!
  t=2: CONNMARK dipasang → tapi SSH sudah mati, tidak ada yang bisa di-mark
```

### Urutan BENAR (SSH aman!)

```
1. ✅ Pasang CONNMARK rules              ← SSH langsung terlindungi
2. ✅ Setup policy routing (table 200)   ← reply SSH punya jalur alternatif
3. ✅ sleep 1                            ← beri waktu paket SSH ter-mark
4. ✅ Ganti default route ke tunnel      ← AMAN, SSH sudah terlindungi

Timeline:
  t=0: SSH aktif, route normal
  t=1: CONNMARK aktif → paket SSH dari eth0 langsung di-mark di conntrack
  t=2: policy routing aktif → table 200 siap
  t=3: sleep 1 → paket SSH yang transit sempat ter-mark
  t=4: route berubah ke wg0 → tapi SSH reply punya mark 200
       → ip rule: mark 200 → table 200 → via eth0 → SSH AMAN ✓
```

> **Pelajaran dari deployment nyata:** Script awal kami memiliki urutan yang salah.
> Ketika dijalankan, SSH session langsung hang. Setelah fix urutan (CONNMARK dulu,
> route terakhir), SSH tetap connected saat tunnel dinyalakan.

---

## ProxyJump: Jalur SSH Kedua

Selain SSH langsung ke IP asli (berkat CONNMARK), Anda juga bisa SSH via VPS Host:

```
Laptop → SSH ke VPS Host → SSH ke VPS Client via tunnel

ssh -J root@103.253.212.145 root@10.0.0.2
         └── jump host ──┘   └── target ─┘
```

### Kapan Pakai ProxyJump?

| Situasi | SSH Langsung | ProxyJump |
|---------|-------------|-----------|
| Normal (tunnel aktif) | ✅ | ✅ |
| VPS Host mati | ✅ | ❌ |
| IP Client diblokir oleh admin | ❌ | ✅ |
| Network Client bermasalah | ❌ | ✅ (via tunnel internal) |
| Ingin akses private network | ❌ | ✅ (via 10.0.0.x) |

### Setup ProxyJump di Laptop

```
# ~/.ssh/config
Host vps-host
    HostName 103.253.212.145
    User root

Host vps-b
    HostName 10.0.0.2
    User root
    ProxyJump vps-host

Host vps-c
    HostName 10.0.0.3
    User root
    ProxyJump vps-host
```

---

## Ringkasan Komponen

### VPS Host (Gateway)

| Komponen | Fungsi |
|----------|--------|
| WireGuard | Terima koneksi tunnel dari client |
| IP Forwarding | `net.ipv4.ip_forward = 1` — izinkan forward paket |
| NAT Masquerade | Ganti IP sumber (10.0.0.x) → IP Public Host |
| FORWARD rules | Izinkan traffic dari/ke tunnel |

### VPS Client

| Komponen | Fungsi |
|----------|--------|
| WireGuard | Buat tunnel ke Host |
| tunnel-up.sh | CONNMARK + policy routing + default route ke tunnel |
| tunnel-down.sh | Cleanup semua perubahan routing |
| CONNMARK | Proteksi SSH — reply keluar via interface fisik |
| Policy routing | Table 200 untuk traffic yang di-mark |
| resolvconf | Diperlukan oleh wg-quick untuk manage DNS |

### Network Rules (di Client)

```
┌─────────────────────────────────────────────────────────────┐
│ Default Route: default dev wg0                               │
│   → semua traffic internet masuk tunnel                      │
│                                                              │
│ Bypass Route: <IP_HOST>/32 via <gateway> dev eth0            │
│   → paket WireGuard (UDP ke host) lewat jalur fisik          │
│   → mencegah routing loop                                    │
│                                                              │
│ CONNMARK: PREROUTING eth0 → set connmark 200                 │
│           OUTPUT connmark 200 → set fwmark 200               │
│   → reply koneksi masuk via eth0 ditandai                    │
│                                                              │
│ IP Rule: fwmark 200 → table 200                              │
│   → traffic yang ditandai gunakan routing table terpisah     │
│                                                              │
│ Table 200: default via <gateway> dev eth0                    │
│   → traffic yang ditandai keluar via jalur fisik             │
└─────────────────────────────────────────────────────────────┘
```

---

**Selanjutnya:** [02 — Setup Host (VPS A)](02-setup-host.md)

# WireGuard VPS Tunnel Gateway

> **Sembunyikan IP Public VPS Client — tampilkan IP VPS Host ke seluruh internet, tanpa kehilangan akses SSH.**

Dokumentasi lengkap untuk setup WireGuard full-tunnel antar VPS, di mana satu atau lebih VPS Client menyalurkan **seluruh traffic internet** melalui VPS Host (Gateway). Hasilnya:

```
VPS Client $ curl -4 ifconfig.me
→ 103.253.212.145    ← IP VPS Host, bukan IP asli Client
```

Sementara itu SSH ke IP asli VPS Client **tetap bisa** kapan saja — termasuk saat tunnel sedang aktif.

---

## Arsitektur

```
                 ┌──────────────────────────────────────────────────────┐
                 │                     INTERNET                         │
                 └──────┬───────────────────┬───────────────┬───────────┘
                        │                   │               │
                  ┌─────┴──────┐     ┌──────┴─────┐   ┌────┴─────┐
                  │  VPS A     │     │  VPS B     │   │  VPS C   │
                  │  (Host)    │     │  (Client)  │   │  (Client)│
                  │ 203.0.113.10│    │198.51.100.20│  │192.0.2.30│
                  │ wg: 10.0.0.1│    │wg: 10.0.0.2│  │wg:10.0.0.3│
                  └──┬──────┬──┘     └──────┬─────┘   └────┬─────┘
                     │      │               │               │
                     │      └───────────────┴───────────────┘
                     │           WireGuard Tunnel (UDP 51820)
                     │
                     ▼
              NAT Masquerade
         (semua traffic keluar
          dengan IP VPS Host)
```

### Dua Jalur SSH ke VPS Client

```
                     ┌──────────────────────────────┐
                     │         Laptop/PC Admin       │
                     └──────┬───────────────┬───────┘
                            │               │
              Jalur 1:      │               │    Jalur 2:
           SSH langsung     │               │   SSH ProxyJump
          ke IP asli        │               │    via VPS Host
          (CONNMARK)        │               │
                            ▼               ▼
                      ┌──────────┐   ┌──────────────┐
                      │ VPS B/C  │   │   VPS Host   │──→ VPS B/C
                      │ IP Asli  │   │  (jump host) │   (10.0.0.x)
                      └──────────┘   └──────────────┘
```

| Jalur | Perintah | Kapan Bisa Dipakai |
|-------|----------|--------------------|
| **Langsung** | `ssh root@IP_ASLI_VPS_B` | ✅ Selalu — bahkan jika VPS Host mati |
| **ProxyJump** | `ssh -J root@VPS_HOST root@10.0.0.2` | ✅ Saat VPS Host hidup |

### Cara Login SSH ke VPS Client saat Tunnel Aktif

Saat WireGuard tunnel sedang aktif di VPS Client, Anda **tetap bisa SSH** ke VPS Client.
Berikut contoh perintah lengkap untuk kedua cara:

#### Cara 1: SSH Langsung ke IP Asli (Recommended)

Cara ini **selalu bisa** — bahkan jika VPS Host sedang mati. Berkat mekanisme CONNMARK,
reply SSH akan keluar via interface fisik (bukan tunnel), sehingga koneksi tidak putus.

```bash
# Contoh: Login ke VPS B (IP asli: 198.51.100.20)
ssh root@198.51.100.20

# Contoh: Login ke VPS C (IP asli: 192.0.2.30)
ssh root@192.0.2.30

# Dengan port custom (misal SSH di port 2222)
ssh -p 2222 root@198.51.100.20

# Dengan private key
ssh -i ~/.ssh/id_rsa root@198.51.100.20
```

> **Penting:** IP yang digunakan adalah **IP Public asli** VPS Client,
> bukan IP tunnel (10.0.0.x) dan bukan IP VPS Host.

#### Cara 2: SSH via ProxyJump (melalui VPS Host)

Cara ini menggunakan VPS Host sebagai "lompatan" (jump host). SSH masuk ke VPS Host dulu,
lalu diteruskan ke VPS Client melalui jaringan tunnel internal (10.0.0.x).

```bash
# Contoh: Login ke VPS B via VPS Host
ssh -J root@203.0.113.10 root@10.0.0.2
#     └── jump host ────┘ └── target ─┘

# Contoh: Login ke VPS C via VPS Host
ssh -J root@203.0.113.10 root@10.0.0.3

# Jika VPS Host pakai port SSH non-standar (misal 2222)
ssh -J root@203.0.113.10:2222 root@10.0.0.2

# Dengan password (jika belum setup key)
ssh -o ProxyCommand="ssh -W %h:%p root@203.0.113.10" root@10.0.0.2
```

#### Cara 2b: SSH Config (supaya tidak perlu ketik panjang)

Buat file `~/.ssh/config` di **laptop/PC lokal** Anda:

```
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
```

Setelah itu cukup ketik:

```bash
ssh vps-b    # Otomatis lewat VPS Host → ke VPS B
ssh vps-c    # Otomatis lewat VPS Host → ke VPS C
```

#### Perbandingan Kedua Cara

| | Cara 1: Langsung | Cara 2: ProxyJump |
|-|-------------------|-------------------|
| **Perintah** | `ssh root@IP_ASLI` | `ssh -J root@IP_HOST root@10.0.0.x` |
| **VPS Host mati** | ✅ Tetap bisa | ❌ Tidak bisa |
| **IP Client diblokir** | ❌ Tidak bisa | ✅ Bisa (lewat Host) |
| **Kecepatan** | Langsung, cepat | Sedikit lebih lambat (2 hop) |
| **Kapan pakai** | Default, sehari-hari | Backup, atau akses private network |

---

## Fitur

- ✅ **IP Masking** — IP Public Client tersembunyi, yang terlihat hanya IP Host
- ✅ **SSH Tetap Bisa** — Akses langsung ke IP asli Client berkat CONNMARK
- ✅ **Dual SSH Path** — Bisa SSH langsung ATAU via ProxyJump
- ✅ **Auto-Start** — Tunnel otomatis aktif saat VPS boot
- ✅ **Health Check** — Monitoring otomatis + auto-recovery jika tunnel bermasalah
- ✅ **Skalabel** — Mudah tambah client baru (hingga 253 per host)
- ✅ **Multi-Host** — Bisa punya beberapa VPS Host dengan subnet berbeda
- ✅ **Portable** — Tidak hardcode nama interface (`eth0`/`ens3`/dll)
- ✅ **IPv6 Leak Prevention** — Panduan disable IPv6 untuk mencegah kebocoran

---

## Prasyarat

| Komponen | Minimum |
|----------|---------|
| OS | Debian 11+ / Ubuntu 20.04+ / Linux modern dengan kernel ≥ 5.6 |
| Akses | Root pada semua VPS |
| Port | **51820/UDP** terbuka dari internet pada VPS Host |
| Tool | `wireguard`, `iptables`, `iproute2`, `resolvconf` (client) |

---

## Daftar Isi Dokumentasi

| # | Dokumen | Deskripsi |
|---|---------|-----------|
| 1 | [Konsep & Arsitektur](docs/01-konsep-dan-arsitektur.md) | Cara kerja tunnel, CONNMARK, perbandingan pendekatan |
| 2 | [Setup Host (VPS A)](docs/02-setup-host.md) | Konfigurasi VPS Host sebagai WireGuard Gateway + NAT |
| 3 | [Setup Client (VPS B/C)](docs/03-setup-client.md) | Konfigurasi VPS Client: full tunnel + CONNMARK + ProxyJump |
| 4 | [Otomasi & Monitoring](docs/04-otomasi-dan-monitoring.md) | Auto-start, health check, systemd timer, recovery |
| 5 | [Troubleshooting](docs/05-troubleshooting.md) | Semua masalah yang ditemukan + solusi (dari deployment nyata) |
| 6 | [Skenario Lanjutan & What-If](docs/06-skenario-lanjutan.md) | Scaling, edge cases, migrasi host, split tunnel |
| 7 | [Referensi Cepat](docs/07-referensi-cepat.md) | Semua perintah penting dalam satu halaman |

### Script & Config

| File | Lokasi Deploy | Fungsi |
|------|---------------|--------|
| [tunnel-up.sh](scripts/tunnel-up.sh) | Client: `/etc/wireguard/` | Aktifkan routing tunnel + CONNMARK |
| [tunnel-down.sh](scripts/tunnel-down.sh) | Client: `/etc/wireguard/` | Kembalikan routing ke normal |
| [wg-health-check.sh](scripts/wg-health-check.sh) | Client: `/usr/local/bin/` | Health check + auto-recovery |
| [wg0-host.conf.example](configs/wg0-host.conf.example) | Host: `/etc/wireguard/wg0.conf` | Template config WireGuard Host |
| [wg0-client.conf.example](configs/wg0-client.conf.example) | Client: `/etc/wireguard/wg0.conf` | Template config WireGuard Client |

---

## Urutan Pengerjaan

```
1. Baca "Konsep & Arsitektur" (opsional tapi direkomendasikan)
          │
2. Setup VPS Host (ikuti docs/02-setup-host.md)
          │
3. Setup VPS Client pertama (ikuti docs/03-setup-client.md)
          │
4. Test: curl -4 ifconfig.me → harus IP Host
   Test: SSH ke IP asli Client → harus tetap bisa
          │
5. Aktifkan otomasi (ikuti docs/04-otomasi-dan-monitoring.md)
          │
6. Reboot test → tunnel auto-start
          │
7. Ulangi langkah 3-6 untuk setiap Client tambahan
```

---

## Catatan untuk AI Agent

Dokumentasi ini ditulis agar bisa dipahami dan dieksekusi oleh AI Agent:

1. **Setiap langkah bersifat atomik** — bisa dikerjakan satu per satu
2. **Placeholder menggunakan format konsisten** — `GANTI_DENGAN_*` atau `<DESKRIPSI>`
3. **Verifikasi disertakan setelah setiap langkah** — bisa digunakan untuk validasi otomatis
4. **Troubleshooting berdasarkan gejala** — cocok untuk pattern matching
5. **Script bersifat idempotent** — aman dijalankan ulang tanpa efek samping duplikat
6. **What-If scenarios** — membantu decision-making untuk edge cases

### Konvensi Placeholder

| Placeholder | Contoh Nilai | Keterangan |
|-------------|-------------|------------|
| `<IP_HOST>` | `103.253.212.145` | IP Public VPS Host |
| `<IP_CLIENT>` | `202.155.94.5` | IP Public VPS Client |
| `<TUNNEL_IP_HOST>` | `10.0.0.1` | IP Tunnel VPS Host |
| `<TUNNEL_IP_CLIENT>` | `10.0.0.2` | IP Tunnel VPS Client |
| `<HOST_PRIVATE_KEY>` | `gJ2lYWz...` | Private key WireGuard Host |
| `<HOST_PUBLIC_KEY>` | `cpDrV16...` | Public key WireGuard Host |
| `<CLIENT_PRIVATE_KEY>` | `abc123...` | Private key WireGuard Client |
| `<CLIENT_PUBLIC_KEY>` | `nYAC4Lf...` | Public key WireGuard Client |

---

## Lisensi

Dokumentasi ini bebas digunakan untuk keperluan pribadi maupun komersial.

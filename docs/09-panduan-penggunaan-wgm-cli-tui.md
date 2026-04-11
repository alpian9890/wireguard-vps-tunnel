# Panduan Penggunaan WGM (CLI & TUI)

Dokumen ini menjelaskan cara menggunakan aplikasi **WGM (WireGuard Manager)** secara lengkap, baik lewat **CLI** maupun **TUI**.

Fokus utama:
- Menjadikan VPS sebagai **Host/Gateway** WireGuard.
- Menjadikan VPS lain sebagai **Client** full tunnel ke Host.
- Mengelola client dari sisi host (tambah/hapus).
- Memutus koneksi client agar kembali ke jaringan private/asli.

---

## 1. Konsep Kerja WGM (Penting Dipahami Dulu)

`wgm` adalah **orchestrator** (pengendali), bukan agent yang harus dipasang di semua VPS.

Artinya:
1. Anda menjalankan `wgm` dari satu mesin controller (misalnya VPS A atau laptop admin).
2. `wgm` menyimpan daftar server di **inventory** lokal.
3. Saat menjalankan command, `wgm` akan SSH ke target server sesuai inventory.

Jadi supaya command berhasil, mesin yang menjalankan `wgm` harus bisa SSH ke server target.

---

## 2. Prasyarat

Sebelum mulai, pastikan:

1. `wgm` sudah terpasang:
   ```bash
   wgm --version
   ```
2. Controller bisa SSH ke semua target:
   ```bash
   ssh root@IP_SERVER_TARGET
   ```
3. Di sisi host, port UDP WireGuard terbuka (default `51820/udp`).
4. Anda memakai user `root` di inventory untuk command `host init` / `client init`.

---

## 3. Instalasi WGM

Install dengan satu perintah:

```bash
curl -fsSL https://raw.githubusercontent.com/alpian9890/wireguard-vps-tunnel/main/scripts/install-wgm.sh | bash
```

Alternatif:

```bash
wget -qO- https://raw.githubusercontent.com/alpian9890/wireguard-vps-tunnel/main/scripts/install-wgm.sh | bash
```

---

## 4. Alur Pertama Kali (Wajib)

Setelah install:

```bash
wgm inventory init
wgm inventory list
```

Inventory default tersimpan di:

```bash
wgm inventory path
# biasanya: /root/.wg-manager/servers.json
```

---

## 5. Menjadikan VPS A sebagai Host/Gateway

Contoh:
- VPS A (host): `203.0.113.10`
- VPS B (client): `198.51.100.20`

> Jalankan semua command ini dari mesin yang meng-host `wgm`.

### 5.1 Tambahkan host ke inventory

Contoh auth pakai SSH key:

```bash
wgm inventory add \
  --name vps-a-host \
  --role host \
  --host 203.0.113.10 \
  --user root \
  --auth key \
  --key-path /root/.ssh/id_rsa \
  --iface wg0
```

### 5.2 Inisialisasi host

```bash
wgm host init \
  --target vps-a-host \
  --endpoint 203.0.113.10 \
  --listen-port 51820 \
  --host-address 10.0.0.1/24 \
  --tunnel-subnet 10.0.0.0/24
```

Yang dilakukan `host init`:
- Install package dasar WireGuard (kecuali `--skip-package-install`).
- Generate `server.key` / `server.pub` jika belum ada.
- Aktifkan `net.ipv4.ip_forward=1`.
- Tulis/siapkan `/etc/wireguard/wg0.conf`.
- Enable + restart `wg-quick@wg0`.

### 5.3 Verifikasi host

```bash
wgm tunnel status --target vps-a-host
wgm peer list --target vps-a-host
```

---

## 6. Menjadikan VPS B sebagai Client dan Konek ke VPS A

### 6.1 Tambahkan client ke inventory

```bash
wgm inventory add \
  --name vps-b-client \
  --role client \
  --host 198.51.100.20 \
  --user root \
  --auth key \
  --key-path /root/.ssh/id_rsa \
  --iface wg0
```

### 6.2 Inisialisasi client + connect ke host

```bash
wgm client init \
  --target vps-b-client \
  --host-target vps-a-host \
  --client-ip 10.0.0.2/32 \
  --endpoint 203.0.113.10 \
  --listen-port 51820
```

Yang dilakukan `client init`:
- Setup key pair client.
- Register peer client ke host.
- Deploy `tunnel-up.sh` dan `tunnel-down.sh` ke client.
- Tulis `/etc/wireguard/wg0.conf` client full tunnel.
- Enable + restart `wg-quick@wg0` di client.

### 6.3 Verifikasi client

```bash
wgm tunnel status --target vps-b-client
wgm doctor quick --target vps-b-client
```

Jika full tunnel aktif, IP publik client harus mengikuti host.

---

## 7. Menambah Client Baru ke Host (Sisi Host)

Ada 2 cara:

### Cara A (paling praktis): pakai `client init` dari server client baru

1. Tambahkan server client baru ke inventory.
2. Jalankan:
   ```bash
   wgm client init --target vps-c-client --host-target vps-a-host --client-ip 10.0.0.3/32 --endpoint 203.0.113.10
   ```

### Cara B (manual peer host): `peer add`

Jika sudah punya public key client:

```bash
wgm peer add \
  --target vps-a-host \
  --public-key <CLIENT_PUBLIC_KEY> \
  --allowed-ip 10.0.0.3/32
```

Lalu pastikan config client di VPS tersebut sudah benar dan tunnel dinyalakan.

---

## 8. Menghapus Client dari Host

Untuk remove peer dari host:

```bash
wgm peer remove \
  --target vps-a-host \
  --public-key <CLIENT_PUBLIC_KEY>
```

Cek ulang:

```bash
wgm peer list --target vps-a-host
```

> Catatan: `peer remove` menghapus peer **live**. Pastikan file config host tetap sinkron jika Anda melakukan custom edit manual.

---

## 9. Disconnect Client dari Host (Kembali ke Jaringan Asli)

Di sisi client:

```bash
wgm tunnel down --target vps-b-client
```

Ini akan menghentikan tunnel WireGuard pada client, sehingga client kembali menggunakan routing/jaringan private/asli VPS tersebut.

Untuk konek lagi:

```bash
wgm tunnel up --target vps-b-client
```

Untuk restart tunnel:

```bash
wgm tunnel restart --target vps-b-client
```

---

## 10. Menggunakan TUI (Tanpa Ngetik Command Panjang)

Jalankan:

```bash
wgm tui
```

Kontrol:
- Arrow Up/Down: pindah menu
- Enter: pilih menu
- Esc / q: keluar

Menu penting yang tersedia:
- `Inventory: Init`
- `Inventory: List/Add/Remove`
- `Host: Init (Gateway)`
- `Client: Init (Connect to Host)`
- `Tunnel: Status/Up/Down/Restart`
- `Peer: List/Add/Remove`
- `Doctor: Quick`
- `Uninstall WGM`

Semua menu TUI menjalankan command yang sama dengan mode CLI, hanya beda antarmuka input.

---

## 11. Skenario Siap Pakai

### Skenario 1 — WGM dipasang di VPS A (Host)

1. Install `wgm` di VPS A.
2. Tambahkan inventory:
   - `vps-a-host` (host, IP VPS A)
   - `vps-b-client` (client, IP VPS B)
3. Jalankan `host init` untuk `vps-a-host`.
4. Jalankan `client init` untuk `vps-b-client` dengan `--host-target vps-a-host`.

### Skenario 2 — WGM dipasang di VPS B (Client)

Bisa juga, **asal VPS B bisa SSH ke VPS A**.

Langkah:
1. Install `wgm` di VPS B.
2. Tambahkan inventory host (VPS A) dan client (VPS B).
3. Jalankan `host init` ke target VPS A.
4. Jalankan `client init` ke target VPS B dengan `--host-target` VPS A.

---

## 12. Command Diagnostik yang Sering Dipakai

```bash
wgm inventory list
wgm tunnel status --target <name>
wgm doctor quick --target <name>
wgm peer list --target <host-name>
```

---

## 13. Uninstall WGM

Uninstall interaktif:

```bash
wgm uninstall
```

Uninstall tanpa prompt:

```bash
wgm uninstall --yes
```

Uninstall + hapus config inventory lokal:

```bash
wgm uninstall --yes --purge-config
```

---

## 14. Catatan Operasional

1. Gunakan alokasi IP tunnel unik per client (`10.0.0.2/32`, `10.0.0.3/32`, dst).
2. Selalu cek `wgm tunnel status` dan `wgm doctor quick` setelah perubahan.
3. Simpan standar penamaan inventory (mis. `vps-a-host`, `vps-b-client`) agar tim konsisten.
4. Jika pakai TUI dan terjadi gangguan terminal SSH, ulangi command dari CLI untuk validasi.

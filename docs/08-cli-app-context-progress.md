# Context & Progress — WireGuard VPS Tunnel CLI/TUI

Dokumen ini adalah sumber konteks utama untuk pengembangan aplikasi **CLI/TUI** berbasis Node.js yang akan mengotomasi operasional WireGuard host/client pada banyak VPS.

Tujuan dokumen:
1. Menyimpan konteks kenapa aplikasi ini dibuat.
2. Menjadi roadmap fitur yang jelas untuk tim.
3. Menjadi progress tracker lintas sesi/anggota tim dengan checklist.

---

## Latar Belakang

Saat ini setup/operasional dilakukan manual dengan membaca beberapa dokumen terpisah (host, client, troubleshooting), lalu menjalankan command satu per satu di VPS.

Dampak:
- Lambat saat mengelola banyak server.
- Rawan typo/ketidakkonsistenan langkah.
- Troubleshooting memakan waktu karena harus cari gejala/solusi manual.

Solusi yang disepakati: membuat aplikasi **WireGuard Manager CLI/TUI** agar workflow utama bisa dieksekusi terstruktur dari satu tool.

---

## Visi Produk

Satu binary CLI yang:
- Bisa dipakai untuk setup host/client.
- Bisa mengelola peer (tambah/hapus/list).
- Bisa kontrol tunnel (up/down/restart/status).
- Punya mode TUI (arrow/enter/esc) agar lebih cepat dipakai operator.
- Punya fitur diagnostik/troubleshooting berbasis pengalaman nyata di repo ini.

---

## Scope Fitur

### MVP (Wajib di v1)

- [ ] `host init`: setup WireGuard host (install, key, config dasar, forwarding, NAT rule, start service)
- [ ] `client init`: setup WireGuard client (install, key, deploy tunnel scripts, config, start tunnel)
- [ ] `peer add`: tambah peer client ke host (live + persist ke config)
- [ ] `peer remove`: hapus peer client dari host (live + persist ke config)
- [ ] `peer list`: tampilkan daftar peer dan status handshake
- [ ] `tunnel up|down|restart|status` untuk host/client
- [ ] `doctor`: diagnosa cepat + rekomendasi perbaikan dari rule troubleshooting
- [ ] inventory multi-server (alias, role, host/IP, auth method, wg interface)
- [ ] TUI menu utama untuk operasi inti (host/client/peer/tunnel/doctor)

### Post-MVP (Setelah v1 stabil)

- [ ] One-click recovery terkontrol untuk masalah umum
- [ ] Health-check scheduler management dari CLI
- [ ] Integrasi notifikasi (Telegram) dari CLI
- [ ] Export/import inventory terenkripsi
- [ ] Wizard migrasi client ke host lain

---

## Kontrak Command MVP (Draft v0.1)

Struktur command disepakati:

```bash
wgm <area> <action> [options]
```

Area dan action awal:

- `inventory init|path|list|show|add|remove`
- `tunnel status|up|down|restart`
- `peer list|add|remove`
- `doctor quick`
- `host init` (setup host + optional create client profile)
- `client init` (setup client + auto connect ke host)
- `uninstall` (hapus binary wgm, optional purge config)
- `tui` (menu operasional untuk command utama + form input)

---

## Keputusan Teknis Awal

- Runtime: **Node.js + TypeScript**
- Mode antarmuka:
  - CLI command mode (non-interactive, cocok automation/script)
  - TUI mode (interactive, navigasi arrow/enter/esc)
- Distribusi: build ke single binary via **pkg**
- Konfigurasi lokal aplikasi: file inventory terpusat (mis. `~/.wg-manager/servers.json`)
- Eksekusi remote: SSH untuk menjalankan command pada VPS target

---

## Prinsip Implementasi

- Idempotent: command aman dijalankan ulang.
- Explicit safety: operasi berisiko harus ada konfirmasi.
- Tidak merusak pola existing: tetap kompatibel dengan `tunnel-up.sh`, `tunnel-down.sh`, dan template config repo.
- Persisten dan auditabel: perubahan penting ditulis ke log yang jelas.
- Fokus operasional nyata: flow berdasarkan dokumen `02`, `03`, `05`, `07`.

---

## Roadmap & Progress

Gunakan checklist berikut sebagai progress utama tim.

### Phase 0 — Inisiasi & Perencanaan

- [x] Inisiatif pembuatan CLI/TUI disepakati
- [x] Dokumen konteks + progress dibuat (dokumen ini)
- [x] Finalisasi requirement detail MVP per command
- [x] Definisikan struktur command final (`wgm <area> <action>`)
- [x] Definisikan format inventory server

### Phase 1 — Fondasi Proyek

- [x] Inisialisasi project Node.js + TypeScript
- [x] Setup linting/formatting/testing dasar
- [x] Struktur folder modular (cli, tui, core, adapters, templates, doctor)
- [x] Loader config + validation schema
- [x] Logger + error model standar

### Phase 2 — Command Operasional Inti

- [x] Implement `host init`
- [x] Implement `client init`
- [x] Implement `peer add`
- [x] Implement `peer remove`
- [x] Implement `peer list`
- [x] Implement `tunnel up|down|restart|status`
- [x] Implement `uninstall` command

### Phase 3 — Diagnostik & Troubleshooting

- [ ] Mapping gejala dari `docs/05-troubleshooting.md` menjadi rule engine
- [x] Implement `doctor` read-only checks
- [ ] Implement rekomendasi fix terarah per gejala
- [ ] Tambah mode safe auto-fix (opsional, harus konfirmasi)

### Phase 4 — TUI

- [x] Layout TUI utama (menu, panel status, panel log)
- [x] Navigasi keyboard (arrow/enter/esc)
- [ ] Form input aman untuk secret/key
- [x] Integrasi seluruh operasi inti ke TUI

### Phase 5 — Packaging & Release

- [x] Build production
- [x] Bundle single binary via `pkg`
- [ ] Uji di Debian/Ubuntu minimal
- [x] Dokumentasi penggunaan tim
- [ ] Rilis v1 internal

---

## Log Update

| Tanggal (UTC) | Update |
|---|---|
| 2026-04-10 | Dokumen context/progress dibuat, roadmap awal dan checklist fase ditetapkan. |
| 2026-04-10 | Fondasi aplikasi v0.1 dibuat: TypeScript project, inventory loader/schema, SSH executor, command structure, tunnel/peer/doctor command awal, dan TUI dasar. |
| 2026-04-10 | `host init` dan `client init` diimplementasikan: host bisa bootstrap + create client profile, client bisa setup lalu register peer ke host secara otomatis. |
| 2026-04-10 | Release binary pertama dibuat (`v0.1.0`), asset `wgm-linux-x64` di-upload ke GitHub Release, installer script `scripts/install-wgm.sh` ditambahkan, dan one-liner install ditulis di README. |
| 2026-04-10 | Perbaikan release: fix bundling asset `blessed` agar `wgm tui` jalan di binary `pkg`, tambah guard TTY untuk `wgm tui`, dan installer menampilkan progress proses/download. |
| 2026-04-10 | Tambah command `wgm uninstall` dengan konfirmasi interaktif, opsi `--yes`, dan opsi `--purge-config` untuk hapus inventory lokal. |
| 2026-04-10 | TUI direvisi agar bisa menjalankan seluruh command operasional utama langsung dari menu + form input (inventory, host/client init, tunnel, peer, doctor, uninstall). |

---

## Cara Update Dokumen Ini

Setiap kali ada pekerjaan selesai:
1. Ubah item checklist dari `[ ]` menjadi `[x]`.
2. Tambahkan ringkasan singkat ke tabel **Log Update**.
3. Jika scope berubah, perbarui bagian **Scope Fitur** dan **Keputusan Teknis Awal**.

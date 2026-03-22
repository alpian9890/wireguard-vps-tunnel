# 04 — Otomasi & Monitoring

## Daftar Isi

- [Auto-Start saat Boot](#auto-start-saat-boot)
- [Verifikasi setelah Reboot](#verifikasi-setelah-reboot)
- [Health Check dengan Auto-Recovery](#health-check-dengan-auto-recovery)
- [Jadwalkan Health Check (systemd timer)](#jadwalkan-health-check-systemd-timer)
- [Monitoring](#monitoring)
- [Recovery Procedures](#recovery-procedures)
- [Boot Delay (jika service gagal saat boot)](#boot-delay-jika-service-gagal-saat-boot)
- [Operasional Harian](#operasional-harian)

---

## Auto-Start saat Boot

### Di VPS Host (VPS A)

```bash
systemctl enable wg-quick@wg0
```

### Di VPS Client (VPS B/C)

```bash
systemctl enable wg-quick@wg0
```

### Verifikasi

```bash
systemctl is-enabled wg-quick@wg0
# Output: enabled
```

---

## Verifikasi setelah Reboot

**Wajib dilakukan** setelah pertama kali enable auto-start. Reboot VPS untuk memastikan tunnel benar-benar auto-start:

```bash
reboot
```

Setelah VPS online kembali, login dan cek:

```bash
# 1. Service aktif?
systemctl is-active wg-quick@wg0
# Output: active

# 2. WireGuard status
wg show
# Harus ada handshake terbaru

# 3. IP terdeteksi (client saja)
curl -4 ifconfig.me
# Harus IP VPS Host

# 4. Default route (client saja)
ip route show default
# Harus: default dev wg0

# 5. CONNMARK aktif (client saja)
iptables -t mangle -L PREROUTING -n | grep CONNMARK
iptables -t mangle -L OUTPUT -n | grep MARK
# Harus ada rules CONNMARK dan MARK
```

### What If: Service gagal start saat boot?

```bash
# Lihat log
journalctl -u wg-quick@wg0 --no-pager -n 50

# Kemungkinan penyebab:
# 1. Network belum ready → lihat "Boot Delay" di bawah
# 2. Config error → fix config dan restart manual
# 3. resolvconf belum ready → tambah delay
```

### What If: Tunnel aktif tapi CONNMARK tidak ada setelah reboot?

```bash
# Cek apakah tunnel-up.sh berjalan
cat /run/wg-tunnel-wg0.state
# Jika file ada → script berjalan tapi mungkin CONNMARK gagal

# Cek iptables manual
iptables -t mangle -L -n -v

# Restart tunnel
systemctl restart wg-quick@wg0
```

---

## Health Check dengan Auto-Recovery + Telegram Alert (Standar)

Standar yang dipakai:

- **Host**: model `vps3.bluerabbit` (cek interface + UDP listen + ip_forward + NAT + umur handshake tiap peer) + **Telegram alert**.
- **Client**: model `vps2.existentialhit` (cek interface + handshake age + default route + CONNMARK + opsional cek egress IP) + **auto-recovery** + **Telegram alert**.

Repo ini menyediakan versi yang mengikuti standar tersebut:

- `scripts/wg-telegram-notify.sh` (helper kirim Telegram + **dedup anti-spam**)
- `scripts/wg-host-health-check-telegram.sh` (HOST)
- `scripts/wg-health-check-telegram.sh` (CLIENT)

> Catatan: Anda tetap bisa pakai script sederhana `scripts/wg-health-check.sh`, tapi **tidak** mengirim alert Telegram dan coverage check-nya lebih minim.

---

### Prasyarat (wajib untuk Telegram)

Siapkan environment variable di server:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Disarankan simpan di file environment khusus systemd, contoh:

```bash
cat > /etc/default/wg-telegram << 'EOF'
TELEGRAM_BOT_TOKEN=123456:ABCDEF...
TELEGRAM_CHAT_ID=6069426587
EOF
chmod 600 /etc/default/wg-telegram
```

---

### Deploy: helper Telegram

```bash
cp scripts/wg-telegram-notify.sh /usr/local/bin/wg-telegram-notify.sh
chmod +x /usr/local/bin/wg-telegram-notify.sh
```

Test cepat:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
  /usr/local/bin/wg-telegram-notify.sh "WG ALERT test: $(hostname)" "test-$(hostname)"
```

---

### Deploy: HEALTH CHECK (CLIENT)

```bash
cp scripts/wg-health-check-telegram.sh /usr/local/bin/wg-health-check.sh
chmod +x /usr/local/bin/wg-health-check.sh
```

Test manual:

```bash
# tanpa cek egress IP
HS_MAX_AGE=600 /usr/local/bin/wg-health-check.sh wg0

# dengan cek egress IP (expected = IP publik host)
HS_MAX_AGE=600 /usr/local/bin/wg-health-check.sh wg0 <IP_PUBLIK_HOST>
```

Check yang dilakukan (client):

- interface wg aktif
- handshake age <= `HS_MAX_AGE` (default 600s)
- default route via wg
- CONNMARK rules ada
- (opsional) verifikasi egress IP via `ifconfig.me` (soft warning bila timeout)

Jika ada problem:

- attempt recovery (restart wg-quick@wg0)
- kirim Telegram `WG ALERT [RECOVERED|FAILED] ...`

---

### Deploy: HEALTH CHECK (HOST)

```bash
cp scripts/wg-host-health-check-telegram.sh /usr/local/bin/wg-host-health-check.sh
chmod +x /usr/local/bin/wg-host-health-check.sh
```

Test manual:

```bash
HS_MAX_AGE=600 /usr/local/bin/wg-host-health-check.sh wg0
```

Check yang dilakukan (host):

- interface wg aktif
- UDP 51820 listening
- ip_forward=1
- NAT MASQUERADE rule ada
- semua peer punya handshake segar (<= `HS_MAX_AGE`)

Jika ada problem: kirim Telegram `WG ALERT [HOST PROBLEM] ...`

---

### Log

```bash
# Client
tail -f /var/log/wg-health-check.log

# Host
tail -f /var/log/wg-host-health-check.log
```

---

## Jadwalkan Health Check (systemd timer)

Systemd timer lebih baik dari cron: terintegrasi journalctl, lebih presisi, bisa lihat status.

### Buat Service Unit (CLIENT)

```bash
cat > /etc/systemd/system/wg-health-check.service << 'EOF'
[Unit]
Description=WireGuard tunnel health check (client)
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/default/wg-telegram
# Ganti <IP_PUBLIK_HOST> dengan IP publik VPS Host Anda
ExecStart=/usr/local/bin/wg-health-check.sh wg0 <IP_PUBLIK_HOST>
EOF
```

### Buat Timer Unit

```bash
cat > /etc/systemd/system/wg-health-check.timer << 'EOF'
[Unit]
Description=Run WireGuard health check every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
```

### (Opsional) Unit untuk HOST

```bash
cat > /etc/systemd/system/wg-host-health-check.service << 'EOF'
[Unit]
Description=WireGuard tunnel health check (host)
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/default/wg-telegram
ExecStart=/usr/local/bin/wg-host-health-check.sh wg0
EOF

cat > /etc/systemd/system/wg-host-health-check.timer << 'EOF'
[Unit]
Description=Run WireGuard host health check every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
```

### Aktifkan

```bash
systemctl daemon-reload
systemctl enable --now wg-health-check.timer
```

### Verifikasi

```bash
# Timer aktif
systemctl list-timers | grep wg-health

# Hasil health check terakhir
systemctl status wg-health-check.service

# Log health check
journalctl -u wg-health-check.service --no-pager -n 20
```

---

## Monitoring

### Status WireGuard Real-Time

```bash
# Sekali
wg show

# Watch mode (refresh tiap 2 detik)
watch -n 2 wg show
```

### Transfer Data per Peer

```bash
wg show wg0 transfer
```

### Log

```bash
# Log systemd service
journalctl -u wg-quick@wg0 -f

# Log health check
tail -f /var/log/wg-health-check.log

# Log kernel WireGuard (jika debug enabled)
dmesg -w | grep wireguard
```

### Quick Status (Satu Perintah)

```bash
echo "=== WireGuard ===" && wg show && echo "" && \
echo "=== Default Route ===" && ip route show default && echo "" && \
echo "=== IP Terdeteksi ===" && curl -4 -s --max-time 5 ifconfig.me && echo "" && \
echo "=== CONNMARK ===" && iptables -t mangle -L OUTPUT -n 2>/dev/null | grep -c "0xc8" | \
    xargs -I{} sh -c '[ {} -gt 0 ] && echo "aktif" || echo "TIDAK aktif"'
```

---

## Recovery Procedures

### Skenario 1: Tunnel Mati, SSH Masih Bisa

```bash
systemctl restart wg-quick@wg0
wg show && curl -4 ifconfig.me
```

### Skenario 2: SSH Langsung ke IP Asli Timeout

Login via jalur alternatif:

```bash
# Opsi 1: ProxyJump via VPS Host
ssh -J root@<IP_HOST> root@10.0.0.2

# Opsi 2: VNC/Console dari dashboard provider
```

Setelah masuk, debug:

```bash
# Cek CONNMARK
iptables -t mangle -L -n -v | grep -E "CONNMARK|0xc8"

# Cek ip rule
ip rule show | grep "fwmark 0xc8"

# Cek routing table 200
ip route show table 200

# Fix: restart tunnel
systemctl restart wg-quick@wg0
```

### Skenario 3: VPS Host Mati

| Apa yang terjadi | Status |
|------------------|--------|
| SSH ke Client via IP asli | ✅ Tetap bisa (CONNMARK) |
| Internet di Client | ❌ Tidak bisa (tunnel down) |
| Setelah Host kembali | ✅ Tunnel auto-reconnect (PersistentKeepalive) |

Tidak perlu tindakan di Client — setelah Host kembali, tunnel otomatis re-establish.

### Skenario 4: Salah Config, Terkunci Total

1. Masuk via **VNC/Console** dari dashboard provider
2. Matikan tunnel:
   ```bash
   wg-quick down wg0
   ```
3. Jika `wg-quick down` error, manual cleanup:
   ```bash
   ip link delete wg0 2>/dev/null
   
   # Baca state file jika ada
   cat /run/wg-tunnel-wg0.state
   
   # Restore default route manual
   ip route replace default via <GATEWAY> dev <INTERFACE>
   
   # Hapus CONNMARK rules
   iptables -t mangle -F PREROUTING
   iptables -t mangle -F OUTPUT
   ip rule del fwmark 200 table 200 2>/dev/null
   ip route flush table 200 2>/dev/null
   ```
4. Fix config, lalu coba lagi

### Skenario 5: Routing Kacau (Tidak Ada Internet dan Tidak Ada SSH)

Melalui VNC/Console:

```bash
# Emergency: hapus semua perubahan
wg-quick down wg0 2>/dev/null
ip link delete wg0 2>/dev/null

# Cari gateway asli
ip route show table 200 2>/dev/null
# ATAU cek dari network config provider Anda

# Restore manual
ip route replace default via <GATEWAY> dev eth0

# Bersihkan semua mangle rules
iptables -t mangle -F

# Bersihkan ip rules tambahan
ip rule del fwmark 200 table 200 2>/dev/null

# Test
ping -c 3 1.1.1.1
ssh root@<IP_CLIENT>    # dari luar
```

---

## Boot Delay (jika service gagal saat boot)

Jika WireGuard gagal start saat boot karena network belum ready:

```bash
mkdir -p /etc/systemd/system/wg-quick@wg0.service.d

cat > /etc/systemd/system/wg-quick@wg0.service.d/delay.conf << 'EOF'
[Service]
ExecStartPre=/bin/sleep 10
EOF

systemctl daemon-reload
```

### What If: 10 detik tidak cukup?

```bash
# Naikkan delay
cat > /etc/systemd/system/wg-quick@wg0.service.d/delay.conf << 'EOF'
[Unit]
After=network-online.target
Wants=network-online.target

[Service]
ExecStartPre=/bin/sleep 30
Restart=on-failure
RestartSec=10
EOF

systemctl daemon-reload
```

---

## Operasional Harian

### Restart Tunnel

```bash
systemctl restart wg-quick@wg0
```

### Matikan Sementara

```bash
systemctl stop wg-quick@wg0     # Matikan
systemctl start wg-quick@wg0    # Nyalakan kembali
```

### Nonaktifkan Auto-Start

```bash
systemctl disable wg-quick@wg0
```

### Backup Config Sebelum Edit

```bash
cp /etc/wireguard/wg0.conf /etc/wireguard/wg0.conf.bak-$(date +%F-%H%M%S)
```

### Update Script dari Repository

```bash
# Download script terbaru
curl -o /etc/wireguard/tunnel-up.sh https://raw.githubusercontent.com/<USER>/<REPO>/main/scripts/tunnel-up.sh
curl -o /etc/wireguard/tunnel-down.sh https://raw.githubusercontent.com/<USER>/<REPO>/main/scripts/tunnel-down.sh
chmod +x /etc/wireguard/tunnel-up.sh /etc/wireguard/tunnel-down.sh

# Restart untuk apply
systemctl restart wg-quick@wg0
```

---

**Sebelumnya:** [03 — Setup Client (VPS B/C)](03-setup-client.md)
**Selanjutnya:** [05 — Troubleshooting](05-troubleshooting.md)

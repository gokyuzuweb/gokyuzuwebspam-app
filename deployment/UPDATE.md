# GökyüzüWebSpam — Sunucuya Kurulum & Güncelleme

## Hızlı Kurulum (İlk Kez)

```bash
# 1. Repo'yu klonla
git clone https://github.com/gokyuzuhosting/gokyuzuwebspam.git /app
cd /app

# 2. install.sh çalıştır (systemd servisleri, cron, dependencies)
sudo bash /app/deployment/install.sh

# 3. gws-update binary'sini kur
sudo cp /app/deployment/gws-update.sh /usr/local/bin/gws-update
sudo chmod +x /usr/local/bin/gws-update

# 4. İlk tam güncellemeyi çalıştır
sudo gws-update --force --verbose
```

## Güncel Tutma (Otomatik)

`gws-update` cron ile 6 saatte bir otomatik çalışır (`/etc/cron.d/gokyuzuwebspam-autoupdate`).

**Manuel çalıştırma:**

```bash
sudo gws-update                  # sessiz (cron modu)
sudo gws-update --verbose        # detaylı log
sudo gws-update --force          # değişiklik yoksa da her adımı çalıştır
sudo gws-update --skip-frontend  # sadece backend + plugin
```

## Ne Yapar?

1. **Git pull** — GitHub main branch'inden en güncel kod
2. **Backend** — `pip install -r requirements.txt` (sadece requirements.txt değiştiyse)
3. **Frontend** — `yarn install && yarn build` (sadece frontend/ değiştiyse)
4. **WHM Plugin** — Perl scripts (`heartbeat.pl`, `mailshield-logtail.pl`), AppConfig, CGI dosyaları
5. **Systemd** — `gws-milter`, `gws-logtail`, `gws-heartbeat` servislerini restart
6. **Supervisor** — Backend restart (supervisor varsa)
7. **Cron** — `/etc/cron.d/gokyuzuwebspam-autoupdate` (yoksa ekle)
8. **State** — `/var/lib/gokyuzuwebspam/update-state.json` (son sürüm + commit)

## Loglar

- **Update log**: `/var/log/gokyuzuwebspam/update.log`
- **State**: `/var/lib/gokyuzuwebspam/update-state.json`
- **Lock**: `/var/run/gws-update.lock` (aynı anda 2 çalışmayı önler)

## Master Panelden Uzaktan Tetikleme

Master panelde **Header → "⬇ Sunucumu Güncelle"** butonu tıklanınca backend
`plugin_demand_update:<license_key>` sinyalini `settings` collection'ına yazar.
Bayi WHM sunucusundaki `heartbeat.pl` 15dk cycle'ında sinyali görüp
otomatik olarak `gws-update` çalıştırır.

## Sorun Giderme

**"Kod indirilmiyor"**: `git fetch origin main` ile manuel dene, SSH key/permissions kontrol et.

**"Backend başlatılmıyor"**: `supervisorctl tail -f backend stderr` ile log kontrol et.

**"Frontend build başarısız"**: `cd /app/frontend && yarn install --force && yarn build` ile manuel dene.

**"Milter aktivite yok"**: `systemctl status gws-milter`, `journalctl -u gws-milter -f`, ayrıca master panelde Dashboard → "Milter Sağlığı" widget'ından auto-reset tetikleyebilirsiniz.

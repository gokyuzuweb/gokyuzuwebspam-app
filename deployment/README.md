# 🚀 GökyüzüWebSpam · Self-Host Kurulum Kılavuzu

## Neden Self-Host?

**Sorun**: Emergent'teki preview URL askıya alındığında paneliniz yanıt vermez, WHM plugin çalışmaz.

**Çözüm**: Sistemi kendi sunucunuza (`89.19.15.58` / `gokyuzuhosting.com`) taşıyın. Tüm veri sizin sunucunuzda; bayiler direkt sizden çeker; Emergent sadece geliştirme ortamı olarak kalır.

---

## Mimari

```
┌──────────────────────────────────────────────────┐
│  panel.gokyuzuhosting.com  (SENİN SUNUCU)        │
│  ┌────────────┐ ┌──────────┐ ┌────────────────┐  │
│  │  Nginx     │ │  React   │ │  FastAPI       │  │
│  │  (443/80)  │→│ Frontend │ │  Backend       │  │
│  │            │ │  (:3000) │ │  (:8001)       │  │
│  └────────────┘ └──────────┘ └───────┬────────┘  │
│                                       ↓            │
│                                ┌──────────────┐   │
│                                │  MongoDB     │   │
│                                │  (persistent)│   │
│                                └──────────────┘   │
└──────────────────────────────────────────────────┘
     ↑                    ↑                   ↑
  bayiler          gokyuzubilgisayar     WHM plugins
                   .com (PHP bridge)     (customer)
     ↑
  emergent (SADECE kod source, cron ile pull)
```

---

## 1. Ön Gereksinimler

- **Sunucu**: Ubuntu 22.04+ / Debian 12+ / AlmaLinux 9+ · en az 2 vCPU · 4 GB RAM · 20 GB disk
- **Domain**: `panel.gokyuzuhosting.com` A record → `89.19.15.58`
- **Portlar**: 80, 443 açık
- **SSH root erişimi**

## 2. Kurulum

```bash
# 1. Sunucuya SSH ile bağlan
ssh root@89.19.15.58

# 2. Repo'yu klonla (Emergent'ten Save-to-GitHub sonrası)
mkdir -p /opt/gws && cd /opt/gws
git clone https://github.com/gokyuzuhosting/webspam.git .

# 3. .env dosyalarını düzenle
cd deployment
nano backend.env       # PayTR, SMTP, BANK_IBAN bilgilerini doldur
nano frontend.env      # REACT_APP_BACKEND_URL'i doğrula

# 4. Kurulumu başlat
chmod +x install.sh scripts/*.sh
sudo bash install.sh
```

Kurulum ~3-5 dk sürer (Docker image build).

## 3. SSL Sertifikası (Let's Encrypt)

```bash
# Nginx container'ını geçici durdur
docker compose stop nginx

# Certbot ile al
apt install -y certbot
certbot certonly --standalone -d panel.gokyuzuhosting.com \
  --email admin@gokyuzuhosting.com --agree-tos --no-eff-email

# Sertifikaları deployment dizinine kopyala
cp /etc/letsencrypt/live/panel.gokyuzuhosting.com/fullchain.pem data/certs/
cp /etc/letsencrypt/live/panel.gokyuzuhosting.com/privkey.pem data/certs/

# Nginx'i tekrar başlat
docker compose start nginx

# Otomatik yenileme cron
echo "0 3 * * * certbot renew --quiet && docker compose -f /opt/gws/deployment/docker-compose.yml restart nginx" | crontab -
```

## 4. Emergent Verilerini Taşıma

```bash
# Emergent tarafında (SSH terminal veya /app/deployment/scripts):
bash /app/deployment/scripts/dump-db.sh
scp gws-backup-*.gz root@89.19.15.58:/tmp/

# Sunucuda:
cd /opt/gws/deployment
bash scripts/restore-db.sh /tmp/gws-backup-*.gz
```

## 5. WHM Plugin Yönlendirmesi

Müşterilerinize verilen WHM plugin `.env`'ini güncelleyin:

```bash
# /opt/gws-plugin/config.env
API_BASE=https://panel.gokyuzuhosting.com/api
LICENSE_KEY=MS-xxxxx
```

Böylece pluginler artık Emergent yerine SENİN sunucuna bağlanır.

## 6. Bayi Panel Bağlantısı

Bayilerinize verdiğiniz kurulum kılavuzunda:

```bash
export API_BASE="https://panel.gokyuzuhosting.com/api"
```

Bayilerin plugin'i / web paneli otomatik olarak SENİN sunucundan çeker.

## 7. gokyuzubilgisayar.com Bridge

`/app/php-bridge/.env.php` dosyasını sitenizin `/includes/` dizinine yükleyin:

```php
define('GWS_API_BASE', 'https://panel.gokyuzuhosting.com/api');
define('GWS_LICENSE_KEY', 'MS-your-master-key');
```

## 8. Otomatik Kod Güncelleme (Emergent'ten)

Emergent'te değişiklik yaptığınızda "Save to GitHub" deyin. Sunucunuzdaki cron her gece 03:00'te en son kodu çeker:

```bash
crontab -e
# Ekle:
0 3 * * * bash /opt/gws/deployment/scripts/update-from-emergent.sh >> /var/log/gws-update.log 2>&1
```

---

## Servis Yönetimi

```bash
# Durum
docker compose ps

# Log takibi
docker compose logs -f backend
docker compose logs -f nginx

# Yeniden başlat
docker compose restart backend

# Tam kapatma
docker compose down

# Backup al
bash scripts/dump-db.sh
```

---

## Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| `panel.gokyuzuhosting.com` açılmıyor | `docker compose ps` — 4 container "running" olmalı |
| SSL hatası | `data/certs/` içinde `fullchain.pem` + `privkey.pem` var mı? |
| MongoDB dolu değil | `bash scripts/restore-db.sh /tmp/backup.gz` |
| API 502 | `docker compose logs backend` — backend crash mı? |
| CORS hatası | `backend.env` içindeki `CORS_ORIGINS`'e frontend domainini ekleyin |

## Destek

- Panel Docs: `/panel/docs`
- Health Check: `https://panel.gokyuzuhosting.com/api/health`
- Master IP kontrolü: `https://panel.gokyuzuhosting.com/api/master/check`

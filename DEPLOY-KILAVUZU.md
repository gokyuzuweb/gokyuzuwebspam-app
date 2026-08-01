# 🚀 GökyüzüWebSpam Deploy Kılavuzu

**Amaç**: Bu sistemi kendi sunucunuzda (gokyuzuhosting.com) production'a alıp,
- Bayilerin `gokyuzuhosting.com`'a heartbeat atmasını sağlamak
- Preview environment'ı geliştirme için kullanmaya devam etmek
- Uykuya geçme sorununu kalıcı çözmek

---

## 📋 Ön Gereksinimler

- Sunucu: Minimum 2 CPU · 4 GB RAM · 50 GB disk (Ubuntu 22.04 önerilir)
- Domain: `gokyuzuhosting.com` (A kaydı sunucu IP'sine yönlendirilmiş)
- SSL: Let's Encrypt otomatik (Nginx yapılandırmalı)
- Portlar açık: 80, 443, 22
- SSH root veya sudo erişimi

---

## 🎯 Mimari: Dual-Source Çalışma Prensibi

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  Preview (mailscanner-pro)   │        │  Production (gokyuzuhosting) │
│  ────────────────────────    │        │  ─────────────────────────   │
│  · Sizin geliştirme ortamı   │        │  · Bayilerin heartbeat ettiği│
│  · Kod değişikliği burada    │        │  · Müşteri sunucuları buraya │
│  · Test edilir              │───►────│    lisans doğrulaması yapar  │
│  · Push edilir              │  git   │  · 7/24 açık kalır (uyumaz)  │
└──────────────────────────────┘        └──────────────────────────────┘
```

**Nasıl çalışır?**
- Preview ortamınız → `mailscanner-pro.preview.emergentagent.com`
- Production'ınız → `gokyuzuhosting.com`
- Bayi plugin'leri `.env` içinde `MASTER_URL=https://gokyuzuhosting.com` görür ve buraya heartbeat atar.
- Preview'a asla bayi heartbeat gelmez. Preview sadece sizin geliştirme aracınızdır.

---

## 🛠️ Adım Adım Kurulum

### 1. Sunucuya Bağlanın

```bash
ssh root@YOUR_SERVER_IP
apt update && apt upgrade -y
```

### 2. Bağımlılıkları Kurun

```bash
apt install -y docker.io docker-compose git nginx certbot python3-certbot-nginx
systemctl enable --now docker
```

### 3. Kodu Sunucuya Alın

**Yöntem A — GitHub üzerinden (önerilen):**
```bash
# Emergent panelinde "Save to Github" yapın, sonra:
cd /opt
git clone https://github.com/KULLANICI/REPO_ADI.git gokyuzuwebspam
cd gokyuzuwebspam
```

**Yöntem B — SFTP ile:**
- Emergent → Ayarlar → "Download Code as ZIP"
- Yerel: unzip → `sftp` ile `/opt/gokyuzuwebspam` altına yükleyin

### 4. .env Dosyalarını Yapılandırın

```bash
# Backend
cat > /opt/gokyuzuwebspam/backend/.env << 'EOF'
MONGO_URL=mongodb://mongo:27017
DB_NAME=gokyuzuwebspam_prod
MASTER_HOST=gokyuzuhosting.com
MASTER_IP=YOUR_SERVER_IP
MASTER_LICENSE_KEY=MS-C02AB012652A4FE692D69676
CORS_ORIGINS=https://gokyuzuhosting.com,https://gokyuzubilgisayar.com
EOF

# Frontend
cat > /opt/gokyuzuwebspam/frontend/.env << 'EOF'
REACT_APP_BACKEND_URL=https://gokyuzuhosting.com
EOF
```

### 5. Docker Compose ile Çalıştırın

Deploy paketi `/app/deployment/` altında hazır:

```bash
cd /opt/gokyuzuwebspam/deployment
docker compose up -d --build
```

Servislerin ayakta olduğunu kontrol edin:
```bash
docker compose ps
# 3 servis olmalı: mongo, backend, frontend
```

### 6. Nginx Reverse Proxy

```bash
cat > /etc/nginx/sites-available/gokyuzuhosting.com << 'EOF'
server {
    listen 80;
    server_name gokyuzuhosting.com www.gokyuzuhosting.com;

    # Backend API (FastAPI)
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend (React build)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
EOF

ln -sf /etc/nginx/sites-available/gokyuzuhosting.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 7. SSL (HTTPS) Kurun

```bash
certbot --nginx -d gokyuzuhosting.com -d www.gokyuzuhosting.com
```

### 8. Doğrulama

```bash
curl https://gokyuzuhosting.com/api/version/current
# {"version":"1.3.3","installed_at":"..."} dönmeli
```

Panelinize erişin: **https://gokyuzuhosting.com/panel**

---

## 🔄 Preview'dan Production'a Kod Geçişi

Her yeni özellik/düzeltme için:

1. **Preview'da geliştirin, test edin.**
2. Emergent'ta **"Save to Github"** yapın.
3. Sunucuda:
   ```bash
   cd /opt/gokyuzuwebspam
   git pull
   cd deployment
   docker compose up -d --build
   ```

Bu kadar. 30 saniye içinde canlı.

---

## 🏗️ PHP Bridge Kurulumu (gokyuzubilgisayar.com)

Satış sayfaları `gokyuzubilgisayar.com`'da olacak, bunlar backend'e cURL ile bağlanacak.

### cyber-security-18 projesine yükleme

1. `/app/php-bridge/` klasöründeki tüm dosyaları FTP/SFTP ile projenize kopyalayın:
   - `index.php` — Ana satış sayfası
   - `ozellikler.php` — 14+ modül showcase
   - `fiyatlar.php` — 3 paket + ödeme
   - `arac-rbl.php` — RBL kontrol aracı (bedava)
   - `arac-mailhealth.php` — Mail sağlığı testi (bedava)
   - `musteri.php` — Lisans sorgulama portalı
   - `iletisim.php` — İletişim formu
   - `gws-bridge.php` — Backend cURL client
   - `inc/layout.php` — Ortak header/nav/footer
   - `.env.php` — Yapılandırma

2. `.env.php` dosyasını düzenleyin:
   ```php
   define('GWS_API_BASE', 'https://gokyuzuhosting.com/api');
   define('GWS_LICENSE_KEY', 'MS-C02AB012652A4FE692D69676');
   ```

3. Web tarayıcısında test edin:
   - `https://gokyuzubilgisayar.com/index.php`
   - `https://gokyuzubilgisayar.com/arac-rbl.php`
   - `https://gokyuzubilgisayar.com/fiyatlar.php`

Bu kadar. Backend her istekte `gokyuzuhosting.com`'a gider (7/24 açık), sitedeki müşteriler kesintisiz hizmet alır.

---

## 🐛 Sorun Giderme

**Backend başlamıyor**
```bash
docker compose logs backend | tail -50
```

**Nginx 502**
```bash
docker compose ps  # servisler ayakta mı?
netstat -tlnp | grep -E "3000|8001"  # portlar açık mı?
```

**Bayi heartbeat gelmiyor**
- Bayi plugin `.env` dosyasında `MASTER_URL=https://gokyuzuhosting.com`
- Sunucu firewall'ında 443 açık
- SSL sertifikası geçerli (`certbot renew --dry-run`)

**MongoDB yedekleme**
```bash
docker compose exec mongo mongodump --archive=/backup/$(date +%F).gz --gzip
```

---

## 🔐 Güvenlik Sıkılaştırma

1. **UFW firewall**: `ufw allow 22,80,443/tcp && ufw enable`
2. **fail2ban**: `apt install fail2ban -y`
3. **MongoDB auth**: `docker compose.yml`'da MONGO_INITDB_ROOT_USERNAME/PASSWORD ayarla
4. **Ortam değişkenleri**: `.env` dosyalarını git'e commit etme
5. **Otomatik yedek**: cron ile günlük mongodump + S3'e yükle

---

## ✅ Kontrol Listesi

- [ ] DNS: `gokyuzuhosting.com` A kaydı sunucuya çözümleniyor
- [ ] SSL: `curl -I https://gokyuzuhosting.com` → 200/301
- [ ] Backend: `curl https://gokyuzuhosting.com/api/version/current` → JSON döner
- [ ] Panel: `https://gokyuzuhosting.com/panel` → Login sayfası
- [ ] PHP bridge: `https://gokyuzubilgisayar.com/index.php` → Landing gösterilir
- [ ] Bayi heartbeat: master heartbeat tablosunda kayıt görünüyor
- [ ] Uyku sorunu: 30 dakika bekleyip tekrar erişim testi → uyumadı

---

**Destek**: destek@gokyuzubilgisayar.com

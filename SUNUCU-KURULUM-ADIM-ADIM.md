# 🚀 SUNUCU KURULUM — Adım Adım (Copy-Paste)

Bu kılavuz sıfırdan bir Ubuntu VPS'te GökyüzüWebSpam'i çalıştırmanız için yazıldı.
**Her satırı sırayla kopyala-yapıştır yaparsanız 15-20 dakikada canlıya çıkar.**

---

## 📋 ÖN HAZIRLIK (5 dakika)

### 1️⃣ Emergent'ta "Save to Github" yapın

- Emergent panelinde sağ üstteki **"Save to Github"** butonuna basın
- GitHub hesabınızı bağlayın
- Yeni repo oluşturun (örn: `gokyuzuwebspam-app`)
- **"Save"** butonu → kod GitHub'a yüklenir
- **Repo URL'sini kopyalayın** (örn: `https://github.com/KULLANICI/gokyuzuwebspam-app.git`)

### 2️⃣ DNS Ayarları

Domain sağlayıcınızın panelinde:
```
A kaydı:     gokyuzuhosting.com     →  SUNUCU_IP_ADRESI
A kaydı:     www.gokyuzuhosting.com →  SUNUCU_IP_ADRESI
```
DNS yayılma: ~5-30 dakika. `nslookup gokyuzuhosting.com` ile doğrulayın.

### 3️⃣ VPS Hazırlığı

Sunucu gereksinimleri:
- **Ubuntu 22.04+** (veya Debian 12+)
- Minimum **2 CPU · 4 GB RAM · 50 GB disk**
- Root veya sudo erişimi
- Firewall açık: 22, 80, 443

---

## 🎯 KURULUM (15 dakika)

### 🔧 ADIM 1 — Sunucuya SSH ile bağlanın

Bilgisayarınızdan terminal açın:
```bash
ssh root@SUNUCU_IP_ADRESI
```

### 🔧 ADIM 2 — Kurulum scriptini çalıştırın

Aşağıdaki komutu **tek satır olarak** kopyalayıp yapıştırın:

```bash
apt update && apt install -y git curl && git clone https://github.com/KULLANICI/gokyuzuwebspam-app.git /opt/gokyuzuwebspam-app && cd /opt/gokyuzuwebspam-app/deployment && bash install.sh
```

⚠️ **`KULLANICI/gokyuzuwebspam-app` kısmını kendi GitHub repo'nuza göre değiştirin!**

Script size şunları soracak:
- Domain adı → `gokyuzuhosting.com` yazın
- E-posta → SSL için (örn: `admin@gokyuzuhosting.com`)
- Master Lisans → boş bırakabilirsiniz (otomatik üretilir)
- Cron aktif olsun mu → **E** (evet)

**⏳ 10-15 dakika bekleyin.** Script otomatik olarak:
- Docker + Nginx + Certbot kurar
- Kodları çeker
- Container'ları başlatır
- SSL sertifikası alır
- Otomatik güncelleme cron'u kurar
- Günlük MongoDB yedek cron'u kurar

### 🔧 ADIM 3 — Kurulum tamamlandı!

Script başarılı biterse şunları göreceksiniz:
```
✓ KURULUM TAMAMLANDI
🌐 Panel:      https://gokyuzuhosting.com/panel
🔐 Master Key: MS-XXXXXXXXXXXXXXXXXXXXXXXX
```

**🚨 Master Key'i güvenli bir yere kaydedin! Panele giriş için gerekli.**

---

## ✅ DOĞRULAMA

Tarayıcıda açın:
- `https://gokyuzuhosting.com/api/version/current` → JSON döner (versiyon bilgisi)
- `https://gokyuzuhosting.com/panel` → GökyüzüWebSpam paneli

Master Key ile giriş yapın → panele erişim başlar.

---

## 🔄 GÜNCELLEME AKIŞI

### Preview'da geliştirdiniz mi? İşte adımlar:

1. **Emergent**: Sağ üstte **"Save to Github"** → kod push edilir
2. **Otomatik**: Sunucuda cron 5 dakikada bir kontrol eder ve günceller
3. **Manuel** (hemen yansıtmak için): Sunucuda çalıştırın:
   ```bash
   bash /opt/gokyuzuwebspam-app/deployment/auto-update.sh
   ```

### Bayilere yeni sürüm duyurma:

1. `https://gokyuzuhosting.com/panel/licenses` → **Yönetim** tab
2. **"Kurulu Sürümü Yayınla"** butonuna basın
3. Otomatik: Tüm bayilere e-posta gider + plugin'leri 15dk içinde algılar

---

## 🐛 SORUN GİDERME

### Panel açılmıyor:
```bash
docker compose -f /opt/gokyuzuwebspam-app/deployment/docker-compose.yml ps
docker compose -f /opt/gokyuzuwebspam-app/deployment/docker-compose.yml logs --tail 50
```

### SSL sertifikası hata:
```bash
# DNS yayılmayı bekleyin, sonra:
certbot --nginx -d gokyuzuhosting.com -d www.gokyuzuhosting.com
```

### Nginx test:
```bash
nginx -t && systemctl reload nginx
```

### Cron çalışıyor mu:
```bash
crontab -l
tail -f /var/log/gws-update.log
```

---

## 📞 Destek

- 📄 Detaylı kılavuz: `/app/DEPLOY-KILAVUZU.md`
- 🔧 Script kaynakları: `/app/deployment/`
- 💬 Sorun: sunucuda `docker compose logs` çıktısını kaydedin, destek e-postasına gönderin

---

## 📄 PHP Bridge (gokyuzubilgisayar.com için)

Ayrıca `gokyuzubilgisayar.com`'a satış sayfalarını yüklemek için:

1. FTP client (FileZilla) ile `gokyuzubilgisayar.com` sunucunuza bağlanın
2. `/app/php-bridge/` klasöründeki **tüm dosyaları** siteye yükleyin
3. `.env.php` dosyasını düzenleyin:
   ```php
   define('GWS_API_BASE', 'https://gokyuzuhosting.com/api');
   define('GWS_LICENSE_KEY', 'MS-XXXXXXXXXXXXXX'); // yeni sunucudaki master key
   ```
4. Test: `https://gokyuzubilgisayar.com/index.php` açılır

Bayiler `gokyuzubilgisayar.com`'dan satın alır → Ödeme `gokyuzuhosting.com` API'sına gider → Lisans otomatik oluşturulur → Bayi WHM plugin'i heartbeat atmaya başlar.

---

**Hazır. Başarılar!** 🚀

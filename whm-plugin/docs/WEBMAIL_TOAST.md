# Webmail First-Login Toast — Roundcube Plugin (v44.00.49+)

## Ne İşe Yarar?

Bir kullanıcı cPanel Webmail (Roundcube) üzerinden e-postasına giriş yaptığında,
sağ-alt köşede **kırmızı bir bildirim (toast)** çıkar:

> 🛡️ **GökyüzüWebSpam Koruması**
> Son 24 saatte size 3 zararlı e-posta gönderildi. Hepsi panel tarafından engellendi.
> Türler: **RAT, Oltalama** · Kaynaklar: attacker@evil.com, spam@bad.tr

Toast **günde bir kez** gösterilir (localStorage ile). 20 sn sonra otomatik kapanır ya da kullanıcı × ile kapatabilir.

---

## Otomatik Kurulum (Önerilen)

`v44.00.49+` sürümlerinde `install.sh` bu plugin'i otomatik yerleştirir:

```bash
sudo bash install.sh --license=MS-XXXX...
```

Adımlar:
1. `/usr/local/cpanel/base/3rdparty/roundcube/plugins/gokyuzuwebspam/` altına plugin dosyaları kopyalanır (`gokyuzuwebspam.php`, `webmail-toast.js`, `config.inc.php`).
2. `config.inc.php`'de `gws_panel_url` bayı license server URL'ine göre otomatik set edilir.
3. Roundcube `config.inc.php` içindeki `$config['plugins']` array'ine `'gokyuzuwebspam'` eklenir.
4. Webmail'in cache'i temizlenmesine gerek yok — plugin sonraki page load'da devreye girer.

Kurulum çıktısı:
```
==> [Webmail] Roundcube toast plugin kuruluyor (v44.00.49)
    ✓ Plugin dosyalari: /usr/local/cpanel/base/3rdparty/roundcube/plugins/gokyuzuwebspam/
    ✓ Plugin config'e eklendi
```

---

## Manuel Kurulum (Nadiren Gerekli)

Eğer `install.sh` `ATLANDI: Roundcube plugin dizini yok` mesajı verirse veya
webmail'i özel bir dizinde çalıştırıyorsanız:

### 1) Plugin dosyalarını yerleştir

```bash
mkdir -p /path/to/roundcube/plugins/gokyuzuwebspam
cp /root/gokyuzuwebspam-setup/scripts/roundcube-plugin/gokyuzuwebspam/*.php \
   /path/to/roundcube/plugins/gokyuzuwebspam/
cp /root/gokyuzuwebspam-setup/scripts/roundcube-plugin/gokyuzuwebspam/webmail-toast.js \
   /path/to/roundcube/plugins/gokyuzuwebspam/
```

### 2) `config.inc.php` oluştur

```bash
cat > /path/to/roundcube/plugins/gokyuzuwebspam/config.inc.php <<'EOF'
<?php
$config['gws_panel_url'] = 'https://panel.gokyuzuhosting.com';  // ← BAYI PANEL URL
EOF
```

### 3) Ana Roundcube config'e plugin'i ekle

`/path/to/roundcube/config/config.inc.php` dosyasını düzenle:

```php
$config['plugins'] = array(
    'archive',
    'zipdownload',
    'gokyuzuwebspam',   // ← EKLE
);
```

### 4) Test

Bir kullanıcı hesabına webmail'den giriş yap. Kullanıcının panele gelen zararlı
mail'lerinden en az 1 tane olması gerekir (test için Master Panel > Liste
Merkezi > 🦠 Kötü URL sekmesinden manuel bir kayıt ekleyip aynı gönderici
ile bir mail gelirse tetiklenir).

Toast çıkmıyorsa:
- Tarayıcı konsolunda hata var mı? (`Ctrl+Shift+I`)
- `curl 'https://panel.gokyuzuhosting.com/api/notifications/for-recipient?email=user@site.com'` çalışıyor mu?
- Roundcube log'u: `/var/log/roundcube/errors` — plugin load edildi mi?

---

## Nasıl Çalışır? (Teknik Detay)

1. Kullanıcı Roundcube'a giriş yapar.
2. `gokyuzuwebspam.php` plugin `mail` task'inde init olur, `webmail-toast.js`'i çıktıya ekler ve `env.gws_user_email` + `env.gws_panel_url`'i inject eder.
3. JS DOM ready'de `fetch(gws_panel_url + '/api/notifications/for-recipient?email=' + gws_user_email)` çağırır.
4. Panel son 24 saatteki `recipient_alerts` kayıtlarını sayıp Türkçe toast mesajı + top 3 sender + kind listesi döner.
5. `count > 0` ise toast render edilir; `localStorage.gws_last_notif_shown` bugünün tarihine set edilir (aynı gün 2. login'de tekrar gösterme).

## Güvenlik

- Endpoint `/api/notifications/for-recipient` **kimliksiz** çağrılır (webmail cross-origin fetch). Bu bilinçli bir tasarım tercihidir:
  - Response'da sadece **count + gönderici email + malware kind + subject** olur (spam meta-data).
  - Mail içeriği, ekleri, bodyleri asla dönmez.
  - Spam-verdict'in düşman tarafından enumerate edilme riski çok düşük (attacker zaten kimin adresini engellediğini bilmek için mail göndermeli).
- İleride: bayı isterse `?token=` parametresi ile HMAC imza doğrulaması ekleyebilir (v44.00.50 backlog).

---

## Frontend / Master Panel Görünüm

Bayı kendi panelinden:
- **Liste Merkezi → 🦠 Kötü URL sekmesi**: yeni pattern ekle
- **GET `/api/notifications/recipient-alerts?license_key=XXX&hours=24`**: bugün kaç kullanıcıya kaç mail engellendi listele
- **GET `/api/notifications/recipient-alerts/digest?license_key=XXX`**: Top 50 kullanıcının bir günlük özeti (E-posta gönderim için ideal)

---

## Sürüm Tarihçesi

- **v44.00.48**: Endpoint + JS tanıtımı, manuel kurulum
- **v44.00.49**: Otomatik `install.sh` deploy + Roundcube plugin sarmalayıcı + dokümantasyon (bu dosya)

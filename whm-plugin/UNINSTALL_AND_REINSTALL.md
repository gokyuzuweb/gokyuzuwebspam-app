# GökyüzüWebSpam — Müşteri Sunucusunda Sıfırdan Kurulum (v44.00.11)

> Bu belge, müşteri (bayı) cPanel/WHM sunucusunda **eski kurulumu tamamen
> temizleyip v44.00.11'i sıfırdan hatasız kurmak** için hazırlanmıştır.
> Tüm komutlar `root` olarak çalıştırılmalıdır.

---

## 1) Sıfırdan Kaldırma (Temiz Silme)

```bash
# 1.1  Timer & servisleri durdur ve devre dışı bırak
sudo systemctl stop  gws-simple-push.timer  gws-simple-push.service \
                     gws-exim-push.timer    gws-exim-push.service \
                     gws-exim-inotify.service \
                     gwsm-auto-update.timer gwsm-auto-update.service \
                     mailshield-api.service mailshield-logtail.service \
                     mailshield-milter.service mailshield-quarantine.timer 2>/dev/null || true

sudo systemctl disable gws-simple-push.timer  gws-exim-push.timer \
                       gws-exim-inotify.service \
                       gwsm-auto-update.timer \
                       mailshield-api.service mailshield-logtail.service \
                       mailshield-milter.service mailshield-quarantine.timer 2>/dev/null || true

# 1.2  systemd unit dosyalarını sil
sudo rm -f /etc/systemd/system/gws-simple-push.{service,timer} \
           /etc/systemd/system/gws-exim-push.{service,timer} \
           /etc/systemd/system/gws-exim-inotify.service \
           /etc/systemd/system/gwsm-auto-update.{service,timer} \
           /etc/systemd/system/mailshield-*.{service,timer}
sudo systemctl daemon-reload

# 1.3  Plugin & CGI dosyalarını sil
sudo rm -rf /usr/local/mailshield \
            /usr/local/cpanel/whostmgr/docroot/cgi/mailshield \
            /usr/local/cpanel/base/frontend/jupiter/mailshield \
            /usr/local/cpanel/base/3rdparty/mailshield \
            /var/cpanel/apps/mailshield.conf \
            /usr/local/sbin/mailshieldctl \
            /usr/local/bin/gwsm-update

# 1.4  (İSTEĞE BAĞLI) Konfig ve log arşivini de sil — TAMAMEN sıfırdan istiyorsan
sudo rm -rf /etc/mailshield /var/log/mailshield /var/spool/mailshield

# 1.5  Kullanıcıyı sil (isteğe bağlı — CGI izinleri için gerekmez)
sudo userdel -r mailshield 2>/dev/null || true

# 1.6  Doğrula: hiçbir mailshield servisi ya da dosyası kalmadı
systemctl list-units --all | grep -iE 'mailshield|gws-' ; echo "---"
ls /etc/mailshield /usr/local/mailshield /usr/local/bin/gwsm-update 2>&1 | head
```

Yukarıdaki komut zinciri bittiğinde sistem tamamen temizdir.

---

## 2) Sıfırdan Kurulum (v44.00.11)

```bash
# 2.1  Master'dan güncel tarball'ı indir
cd /root
curl -fsSL https://panel.gokyuzuhosting.com/api/plugin/download -o gws-latest.tar.gz

# 2.2  Aç
tar -xzf gws-latest.tar.gz
cd gokyuzuwebspam

# 2.3  Kur (lisans anahtarınızla — master'dan aldığınız MS-... key)
sudo bash install.sh --license=MS-XXXXXXXXXXXXXXXXXXXX \
                     --license-server=https://panel.gokyuzuhosting.com

# 2.4  Timer'ların aktif olduğunu doğrula
systemctl list-timers gws-*.timer mailshield-*.timer

# 2.5  Anında bir heartbeat tetikle (master paneli 5 dk beklemesin)
sudo systemctl start gws-simple-push.service

# 2.6  Doğrula: master panelde "Kurulu Versiyon" v44.00.11 gösteriyor mu?
#      Panel > Lisanslar sayfasına git, ilgili müşteri satırına bak.
#      Beklenen: yeşil rozet "v44.00.11" · güncel

# 2.7  Log'ları izle (opsiyonel — troubleshoot için)
tail -f /var/log/mailshield/logtail.log
```

---

## 3) Master Panelde Doğrulama

Master paneli aç → **Kontrol Paneli** → aşağıdaki widget'lar test edilir:

- **Exim Push Sağlığı** widget'ı `SAĞLIKLI` (yeşil) olmalı
- **Son Güncellenen Bayılar** widget'ı yeni müşteriyi
  `v? → v44.00.11 (güncel)` şeklinde göstermeli
- **Lisanslar** sayfası ilgili satırda `v44.00.11` (yeşil, güncel) badge

---

## 4) Uzaktan Tek Satır Alternatifi (SSH Copy Assist)

Master panelde **Onar** modalını açtığınızda "Uzaktan tetikle" bölümü
size aşağıdaki formatta bir tek-satır komut kopyalar:

```bash
ssh root@customer-server.com "sudo gwsm-update"
```

Bu komut müşteri sunucusundaki mevcut kurulumu **yerinde günceller**
(yani UNINSTALL yapmadan yeni sürüme atlar). Ancak "sıfırdan hatasız"
istediğiniz için yukarıdaki **1. bölümü** (kaldırma) çalıştırmanız
tavsiye edilir.

---

## 5) Sorun Giderme

**Master panelde Kurulu Versiyon güncellenmiyor?**
1. `sudo systemctl status gws-simple-push.timer` — aktif mi?
2. `sudo journalctl -u gws-simple-push.service -n 20` — heartbeat curl 200 mü?
3. `cat /etc/mailshield/plugin.version` — v44.00.11 yazıyor mu?
4. `sudo systemctl start gws-simple-push.service` — manuel tetikle
5. Master panele bak: 5-10 saniye içinde `last_heartbeat_version` güncellenmeli
   (v44.00.11 fix'i sayesinde IP mismatch olsa BILE version yazılır)

**Push Sağlığı KIRMIZI?**
- Onar modalını aç → tek komut kopyalanır → müşteri sunucusunda yapıştır
- Ya da SSH Copy Assist ile uzaktan `ssh root@... "sudo gwsm-update"`

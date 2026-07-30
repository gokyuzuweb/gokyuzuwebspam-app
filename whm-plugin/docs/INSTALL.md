# GökyüzüWebSpam — Kurulum Kılavuzu

**Hedef:** cPanel/WHM **136.0.32** (110+ ile uyumlu)
**Öncelik:** Aktif cPanel sisteminize dokunmadan, tamamen opt-in kurulum.

---

## 0. Kurulumdan Önce (5 dk kontrol listesi)

- [ ] WHM sürümü ≥ 110 : `cat /usr/local/cpanel/version`
- [ ] Root SSH erişimi var mı?
- [ ] Sistem yedeği alındı mı? (opsiyonel ama önerilir)
- [ ] Exim çalışıyor mu? `systemctl status exim`
- [ ] SpamAssassin var mı? `spamc -V` (yoksa WHM > Service Manager'dan aç)
- [ ] MongoDB kurulu mu? (yoksa bir sonraki adımda kur)

---

## 1. MongoDB (yoksa)

```bash
# CloudLinux/AlmaLinux/RHEL 8/9
cat >/etc/yum.repos.d/mongodb-org-7.0.repo <<EOF
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/\$releasever/mongodb-org/7.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-7.0.asc
EOF
yum install -y mongodb-org
systemctl enable --now mongod
```

> **Not:** MongoDB yalnızca 127.0.0.1'de dinler. Mevcut MySQL/MariaDB'nize
> hiçbir etkisi yoktur.

---

## 2. Paketi Sunucuya Aktarın

```bash
# Yerel makinenizden
scp -r whm-plugin root@sunucunuz.com:/root/

# Sunucuya bağlanın
ssh root@sunucunuz.com
cd /root/whm-plugin
chmod +x install.sh uninstall.sh mailshieldctl
```

---

## 3. Kurulum (Dry Run ile Deneyin)

Önce hiçbir dosya yazmadan neler yapacağını gösteren dry-run:

```bash
./install.sh --dry-run
```

Beğendiğinizde gerçek kurulum:

```bash
./install.sh
```

Kurulum sırasında **hiçbir mevcut cPanel dosyası** yeniden yazılmaz.
`cp -n` (no-clobber) kullanılarak yalnızca eksik dosyalar eklenir.

---

## 4. WHM'de Panele Erişim

WHM'ye giriş yapın → sol menüde **Plugins → GökyüzüWebSpam** görünecektir.
Görünmüyorsa:

```bash
/usr/local/cpanel/bin/register_appconfig /var/cpanel/apps/mailshield.conf
/scripts/restartsrv_cpsrvd
```

---

## 5. Milter Bağlantısı (**OPT-IN** — mail akışını gerçekten koruma zamanı)

GökyüzüWebSpam kurulumdan sonra **gözlem modundadır** — dashboard çalışır,
manuel karantina/liste yönetimi yapılabilir, ama gerçek e-posta akışına
dokunmaz.

Mail'i gerçekten süzmek istediğinizde:

**Adım 1** — Milter servisini başlatın:
```bash
systemctl enable --now mailshield-milter.service
```

**Adım 2** — Exim'e milter'ı tanıtın:
- WHM → **Exim Configuration Manager** → **Advanced Editor**
- Şu satırı ekleyin:
  ```
  milters=inet:127.0.0.1:33333
  ```
- Save (kaydet), sonra:
  ```bash
  /scripts/buildeximconf
  /scripts/restartsrv_exim
  ```

**Test:**
```bash
tail -f /var/log/mailshield/milter.log
# Başka bir terminalden mail gönderin
echo "test" | mail -s "Test" root@localhost
```

> ⚠️ **Cayma:** Bir sorun olursa `milters=` satırını Advanced Editor'den
> silmeniz + `/scripts/buildeximconf && /scripts/restartsrv_exim` çalıştırmanız
> yeterlidir. cPanel eski durumuna döner.

---

## 6. Motor Entegrasyonları

### SpamAssassin
Zaten WHM > Service Manager'dan yönetilir. GökyüzüWebSpam yalnızca `spamc` çağırır.

### ClamAV (opsiyonel)
```bash
yum install -y clamav clamav-server clamav-update clamav-scanner-systemd
freshclam
systemctl enable --now clamd@scan
mailshieldctl engine enable clamav
```

### DCC (opsiyonel)
```bash
yum install -y dcc || cpan -T DCC::Client
mailshieldctl engine enable dcc
```

### Vipul's Razor (opsiyonel)
```bash
yum install -y razor-agents
razor-admin -create
razor-admin -register
mailshieldctl engine enable razor
```

### AI Sınıflandırma (opsiyonel)
`/etc/mailshield/mailshield.conf` içine Emergent LLM anahtarını yazın:

```ini
[ai]
provider           = emergent
model              = claude-sonnet-4.5
emergent_llm_key   = sk-emergent-...
```

Ardından panel > Motorlar > **AI Sınıflandırma** → Başlat.

---

## 7. cPanel Kullanıcı Erişimi

Kullanıcılar için MailControl arayüzü otomatik eklenir:
- cPanel > **Email** > **GökyüzüWebSpam MailControl**
- Kullanıcı kendi karantinasını görür, sadece kendi hesabına ait mesajları
  release/delete edebilir.

Belirli reseller/paket için feature kısıtlaması:
- WHM > **Feature Manager** > "GökyüzüWebSpam MailControl" satırını istediğiniz
  Feature List'inden çıkarın/ekleyin.

---

## 8. Kaldırma

```bash
cd /root/whm-plugin
./uninstall.sh
```

- GökyüzüWebSpam servisleri durdurulur
- AppConfig kaydı silinir
- `/usr/local/mailshield` kaldırılır
- **`/etc/mailshield/` ve `/var/log/mailshield/` KORUNUR** (denetim için)
- Exim / SpamAssassin / cPanel yapılandırmalarına **HİÇ dokunulmaz**

Milter'ı Exim'den de temizlemek isterseniz:
- WHM > Exim Configuration Manager > Advanced Editor
- `milters=inet:127.0.0.1:33333` satırını silin, Save
- `/scripts/buildeximconf && /scripts/restartsrv_exim`

---

## 9. Sorun Giderme

| Belirti | Kontrol |
|---|---|
| Panel WHM'de görünmüyor | `/scripts/restartsrv_cpsrvd`, sonra F5 |
| API çalışmıyor | `systemctl status mailshield-api`, `journalctl -u mailshield-api` |
| MongoDB hatası | `systemctl status mongod`, `mongo --eval 'db.stats()'` |
| Karantina boş | Milter aktif mi? `systemctl status mailshield-milter` |
| Mail teslim edilmiyor | Milter'ı Exim'den ayırın (bkz. Adım 5 caymay) |

Log konumları:
- `/var/log/mailshield/api.log`
- `/var/log/mailshield/milter.log`
- `/var/log/mailshield/quarantine.log`

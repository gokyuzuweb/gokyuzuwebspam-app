# MailShield Pro — WHM/cPanel Mail Security Plugin

**MailShield Pro** is a comprehensive, easy-to-use spam & malware management plugin
for WHM/cPanel (target: **cPanel 136.0.32**). It is a modernised alternative to
ConfigServer MailScanner with a Security-Operations-Center inspired UI.

## Features

- **Karantina Yönetimi** — Kullanıcı bazlı e-posta karantinası, önizleme, release/delete,
  günlük / haftalık raporlar.
- **Whitelist / Blacklist** — IP, domain veya e-posta düzeyinde; global veya kullanıcı bazlı.
- **Motorlar** — Apache SpamAssassin (Bayes + puanlama), ClamAV antivirüs, DCC, Vipul's Razor.
  Rspamd alternatifi ve Emergent LLM tabanlı AI sınıflandırma katmanı da mevcuttur; **hangisi
  aktif edilirse o kullanılır**.
- **Dashboard** — Gerçek zamanlı trafik grafikleri, spam/ham oranları, kullanıcı bazlı
  istatistikler, top-sender IP haritası.
- **Kurallar** — GUI tabanlı SpamAssassin custom rule editor + regex desen testleyici.
- **Politika** — Eşik ayarları (low / high), karantina retention, TLS zorunluluğu,
  outbound rate limit.
- **Kullanıcı Kontrolü** — cPanel içinde MailControl arayüzü; kullanıcı kendi karantinasını
  yönetir.

## Mimari

```
Exim → milter (127.0.0.1:33333) → mailshield-milter
                                     ├─ SpamAssassin  (spamc)
                                     ├─ ClamAV        (clamdscan)
                                     ├─ DCC           (dccif)
                                     ├─ Razor         (razor-check)
                                     └─ AI classifier (opsiyonel; Emergent LLM)
mailshield-api      (127.0.0.1:8001, FastAPI)
mailshield-quarantine (systemd timer, retention temizliği)
MongoDB local       (karantina, listeler, kurallar, loglar)
WHM CGI proxy       (/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/)
cPanel plugin       (Email → MailShield MailControl)
```

## Kurulum (cPanel 136.0.32)

Detaylı adım-adım kılavuz için `docs/INSTALL.md` dosyasına ya da panel içindeki
**Kurulum Kılavuzu** sekmesine bakın.

```bash
# Root olarak SSH ile sunucuya bağlanın
scp -r ./whm-plugin root@<sunucu>:/root/
ssh root@<sunucu>
cd /root/whm-plugin
chmod +x install.sh
./install.sh --domain=mailshield.example.com
```

Kurulumun sonunda WHM &gt; Plugins &gt; **MailShield Pro** menüsünden panele
erişebilirsiniz.

## Komut Satırı — `mailshieldctl`

```
mailshieldctl status
mailshieldctl restart
mailshieldctl engine enable dcc
mailshieldctl engine disable razor
mailshieldctl policy import /path/policy.json
mailshieldctl quarantine prune
mailshieldctl bayes rebuild
```

## Kaldırma

```bash
cd /root/whm-plugin
./uninstall.sh
```

## Dosya Yapısı

```
whm-plugin/
├── install.sh
├── uninstall.sh
├── mailshieldctl
├── appconfig/mailshield.conf          # WHM AppConfig
├── whm/
│   ├── mailshield.cgi                 # WHM CGI proxy
│   └── mailshield.tmpl                # WHM Template Toolkit shell
├── cpanel/
│   ├── mailshield.live.php            # cPanel plugin (MailControl)
│   └── mailshield.cpanelplugin
├── lib/SpamGuard/
│   ├── Milter.pm
│   ├── Engines.pm
│   └── Config.pm
├── scripts/
│   ├── mailshield-milter.pl
│   └── quarantine-prune.pl
├── systemd/
│   ├── mailshield-api.service
│   ├── mailshield-milter.service
│   └── mailshield-quarantine.timer
├── config/
│   ├── mailshield.conf
│   └── policy.default.json
└── docs/
    └── INSTALL.md
```

## Lisans

Ticari kullanım için ayrı bir lisans anlaşması gereklidir. Kaynak
kodu; okumak, denetlemek ve site içi özelleştirmeler için kullanılabilir.

## Destek

- Dahili panel: **Kurulum Kılavuzu** sekmesi
- Log dosyası: `/var/log/mailshield/*.log`
- Sağlık kontrolü: `mailshieldctl status`

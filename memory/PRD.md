# GökyüzüWebSpam — WHM/cPanel Mail Security Plugin (v1.1)

## Marka & Amaç
Satılabilir WHM/cPanel eklentisi (ConfigServer MailScanner alternatifi). Hedef cPanel 136.0.32.

## Bu Session (bugfix + fiyatlandırma)
- ✅ BUG FIX: AI Kural Üretici 20s timeout → axios `llmClient` 90s
- ✅ BUG FIX: Blacklist Delist 500 (ObjectId serialization) → insert_one'a dict kopyası
- ✅ YENİ: Fiyatlandırma sayfası (seller-only) — 3 plan (starter/pro/enterprise), aylık/yıllık,
      özellik listesi, Stripe lookup key, para birimi. Backend `/api/pricing` GET public, PUT seller-only.
- ✅ i18n strings'e "pricing" 6 dilde eklendi
- ✅ Rules.js React hydration uyarısı düzeltildi

## Önceki Session'lardan Mevcut (özet)
- 14 sayfalık admin panel (Turkish/EN/DE/FR/ES/AR i18n)
- SpamAssassin/ClamAV/DCC/Razor + Rspamd + AI (Claude/GPT/Gemini)
- Karantina, whitelist/blacklist, kurallar (AI generator), motorlar, giden posta
- Bildirimler (yönetici e-postası + Slack), PDF haftalık rapor, blacklist/RBL çıkışı (15 sağlayıcı)
- Lisans yönetimi (UUID key, IP allowlist, heartbeat 403, ihlal alert) — SELLER-ONLY
- Fiyatlandırma yönetimi — SELLER-ONLY
- Version manifest + update check
- 7 günlük demo + IP bazlı otomatik lisans doğrulama + LicenseGate modal (customer mode)
- WHM plugin paketi (28 dosya): AppConfig, CGI proxy, cPanel MailControl, milter, heartbeat daemon,
  systemd unit'leri, install.sh (dry-run + cp -n, non-destructive), uninstall.sh, mailshieldctl CLI

## Test Doğrulaması (testing_agent iteration 1)
- Backend: 11/11 pass (%100)
- Frontend: 12+ sayfa · AI + delist + pricing + gate + verify hepsi doğrulandı
- Critical bugs: 0, minor bugs: 0

## Backlog
- P1: Tüm sayfaların içerik i18n çevirisi (şu an sadece sidebar + header nav çevirili)
- P1: Stripe checkout entegrasyonu (fiyat kart butonundan doğrudan ödeme)
- P2: Sürüm otomatik güncelleme (`mailshieldctl update`)
- P2: Reseller alt-yetki matrisi (bayinin de kendi müşterilerine "sub-license" verebilmesi)
- P3: Grafana webhook uyumu
- P3: Multi-language PDF rapor

## Test Credentials
Auth-free preview. WHM'ye kurulduğunda Whostmgr::ACLS root kontrolü uygulanır.
Seed lisans: "Örnek Müşteri A.Ş." → IP 203.0.113.10 (verify-license testi için)

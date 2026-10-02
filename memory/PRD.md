# GökyüzüWebSpam — Product Requirements Document

## Ürün Kimliği
- **İsim:** GökyüzüWebSpam
- **Tip:** WHM/cPanel commercial mail security plugin (SaaS + on-premise hybrid)
- **Kullanıcı:** Türkiye pazarındaki hosting sağlayıcıları, kurumsal MTA operatörleri
- **Rakipler:** ConfigServer MailScanner, MagicSpam, MailScanner Pro
- **Dil kısıtı:** SADECE TÜRKÇE arayüz ve destek

## Mimari
- Frontend: React (SPA) — panel.gokyuzuhosting.com
- Backend: FastAPI (Docker container: gws-backend)
- DB: MongoDB (Docker container: gws-mongo)
- Master Sunucu: Kullanıcının kendi WHM'i (ns1.gokyuzuhosting.com), Docker Compose
- Release Server: Emergent preview URL — `/api/plugin/download` on-the-fly tarball
- Web server: LiteSpeed (Apache emulation, `.htaccess` uyumlu)
- Deployment: `gws-update` (backend/frontend), `gwsm-update` (WHM plugin CGI)

## Şu An Tamam Olan Katmanlar (v44.00.60)
1. **30 özel SpamAssassin kuralı**
   - Bangladesh RFQ scam meta (subject + Dhaka + tender CTA = +6.0)
   - Typosquat detection (L→1, O→0, extra letter)
   - Türkçe parola/şifre credential harvest meta (+5.5)
   - Malware URL (.exe/.jar) + attachment detection
   - HTML-only phishing meta
   - Test sonucu: skor 19.2 (5.6 orijinalden 3.4x güçlenme)

2. **Dovecot Sieve global-before filter**
   - X-Spam-Flag: YES → INBOX.Junk otomatik
   - IMAP namespace: `INBOX.` prefix'li (Maildir++ format)
   - Path: `/etc/dovecot/sieve/before.d/00-gws-spam-to-junk.sieve`

3. **cPanel SpamBox fallback**
   - Global default aktif
   - 188 mevcut hesapta `.spamassassinboxenable` dosyası

4. **Exim ACL reject** (SMTP kabul seviyesi)
   - seriisdokum.com, siatex1td.com + wildcard
   - 185.91.126.147, 188.119.122.20 host bazlı

5. **Multi-tenant loopback bypass** (v44.00.60)
   - `tenant.py::resolve_tenant_scope` — RFC1918 private IP → is_master=True
   - Docker bridge (172.17.x.x) master yetkisiyle çalışır
   - CLI/cron blacklist ekleme artık plan gate'e takılmıyor

6. **USOM feed integration**
   - Otomatik 500+ phishing domain blacklist ekleme
   - `USOM otomatik ekleme · phishing` note ile

7. **URLhaus feed cron** (6 saatte bir)
8. **DMARC aggregate fetcher** (6 saatte bir)
9. **Master hosted-domains push** (24 saatte bir)
10. **Roundcube toast plugin** (webmail bildirim)
11. **Auto-update timer** (24 saatte bir gwsm-update)
12. **Real-time inotify exim log push**

## Bilinen Kısıtlar
- **`/api/*` LiteSpeed proxy**: Kullanıcının panel.gokyuzuhosting.com'da `[P]` flag'i çalışmıyor. Şu an loopback (Docker internal) çalışıyor ama harici admin panel'den API çağrıları için hâlâ ProxyPass config gerekli. `cpanel-native include` (`/etc/apache2/conf.d/userdata/...`) denendi, LSWS restart sonrası test edilmedi.

## Test Credentials
- `/app/memory/test_credentials.md` — güncel değil (kullanıcı kendi WHM üzerinde çalışıyor)
- Production: kullanıcının kendi WHM root erişimi

## Deployment Akışı
1. Emergent preview'da kod değiştir + `/app/VERSION` bump
2. `sudo supervisorctl restart backend` (Emergent'te)
3. Kullanıcı WHM sunucusunda `gws-update` → `/api/plugin/download` tarball'ını çeker → Docker containers otomatik güncellenir

## Aktif Sürüm: v44.00.66 (02 Şubat 2026)

### v44.00.66 — Canlı Trafik Donma + AI Analiz "Invalid Date" + Akıllı Hata Mesajları
- **Arama donması**: Client-side filtering 50K kaydı JS'ye çekip tarıyor, tarayıcı donuyor. **Fix**: Backend `/events?q=` parametresi (MongoDB $regex). Frontend 100-500 kayıt çekiyor, Mongo kendi tarafında ARA.
- **Varsayılan limit**: Stale localStorage değeri (500K/50K) her açılışta 100'e sıfırlanıyor. Kullanıcı manuel seçerse o kalır.
- **"Lisans anahtarı geçersiz" misleading**: Her hata türü için gerçek sebep gösteriliyor (401/403/404/422/429/5xx/timeout/network).
- **Akıllı retry**: 401/403/422 → retry yok, 5xx/timeout → 2 kez retry (geçici sorunlar kullanıcıdan gizli).
- **AI Sistem Analizi**: Backend boş `{}` döndüğünde frontend "Invalid Date" gösteriyordu. `hasReport = !!(report && report.generated_at)` ile gerçek varlık kontrolü eklendi.

## Aktif Sürüm: v44.00.65 (02 Şubat 2026)

### v44.00.65 — Canlı Mail Trafiği React Çökmesi Düzeltildi
- **Root cause**: Kullanıcı eski "500.000 limit" deneme değerini localStorage'da bırakmıştı. Her açılışta backend'e `limit=500000` gönderiliyordu. Backend `Query(50, ge=1, le=50000)` ile 422 dönüyordu. FastAPI'nin 422 `detail` cevabı bir **object array** (type/loc/msg/input/ctx/url). React bu objeyi JSX child olarak render edemediği için `Objects are not valid as a React child` fırlatıp **tüm iframe'i çökertiyordu** → kullanıcı Canlı tab'ına tıkladığında bembeyaz/boş sayfa görüyordu.
- **Fix 1**: `LiveMailEvents.js` useState initializer'da stale localStorage değerini `Math.min(v, 50000)` ile her açılışta clamp.
- **Fix 2**: `invalid` hata bloğunda FastAPI detail'ını güvenli şekilde string'e çevir (array/object → msg join).

## Aktif Sürüm: v44.00.60 (24 Eylül 2026)

## Backlog / Yapılacaklar (P1/P2)
- P1: `server.py` (14.5K satır) route dosyalarına bölmek (quarantine, lists-manager, pricing)
- P1: LiteSpeed `/api/*` proxy — cPanel Apache include ile ProxyPass (test edilmesi lazım)
- P2: Marketplace SA Rule Sharing frontend UI genişletme
- P2: `mailshield-inbox-purge.pl` mailbox lock dayanıklılığı
- P2: cPanel `.spamassassinboxenable` — mevcut hesap migration script (arka planda çalışıyor)

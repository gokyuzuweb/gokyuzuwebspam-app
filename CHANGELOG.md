# GökyüzüWebSpam — Sürüm Notları

Her etiket bir üretim güncellemesidir. `gws-update` script'i bu dosyadan
mevcut sürümü okur ve remote'daki `VERSION` dosyasıyla karşılaştırır.

## v43.22 — Stripe Default Gateway + Version Naming (2026-02-14)
- Ödeme Panosu'na "Varsayılan Ödeme Yöntemi" toggle kartı — Stripe ⇄ Havale tek tıkla
- Backend: `POST /api/admin/payment-settings` `default_gateway=stripe` kaydedildi
- Buy Now akışı artık `checkout.stripe.com` URL'i döndürüyor (Stripe API key aktif)
- `/app/VERSION` dosyası eklendi, `gws-update` artık commit hash yerine sürüm adı gösteriyor
- `CHANGELOG.md` eklendi — her sürüm için başlık + değişiklikler burada

## v43.21 — Global Spotlight Search + Modernize Sidebar (2026-02-14)
- Header'a orta genişlikte glass arama çubuğu (⌘K)
- Sidebar 8 gruba bölündü (İzleme/Koruma/Posta/Kullanıcı/Satış/Bildirim/Master/Sistem)
- Aktif menü için indigo shine + glow shadow

## v43.20 — P0 Bug Triage (2026-02-14)
- `App.js` sidebar syntax hatası fix — tüm app compile ediyor
- `/api/checkout/` demo write-guard whitelist'e eklendi (Satın Al butonu çalışıyor)
- PaymentsAdmin "Bildirim Kutusu" farklı tipler için ayrı render (badge / alert / havale)

## v43.19 — Panel SPA iframe-aware (2026-02-13)
- WHM plugin iframe'inde panel SPA kendi yüksekliğini kilitler
- postMessage ile parent'a resize sinyali gönderir

## v43.18 — WHM Fullscreen ULTRA + Milter Body/Attachment (2026-02-13)
- 4 katmanlı WHM iframe escape (window.top + parent DOM chrome hide + wrapper + iframe pos:fixed)
- Milter body ingest verified · attachment inline preview

## v43.11-v43.17
- Landing Multi-lang CMS + A/B Test + Confidence Score
- Cmd+K Recent History + Fuzzy Turkish + Global Actions
- Achievement Badges + Twitter Share
- Milter Body Ingest + Türkçe subject mojibake fix

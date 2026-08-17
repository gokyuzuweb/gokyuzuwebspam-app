# GökyüzüWebSpam — Master vs Bayi Mimarisi

**Sürüm:** v43.68 · Ocak 2026

---

## 🎯 Kısaca

Bu program **iki ayrı rolle** çalışır. Her rolün **KENDİ sunucusu** ve **KENDİ MongoDB'si** vardır. Bayiler master DB'ye ETKİ EDEMEZ. Master, bayilerin sunucularına doğrudan bakmaz; sadece lisans/kod dağıtır.

---

## 👑 MASTER (Ana Yönetici) — panel.gokyuzuhosting.com

**Kim?** Ürünü satan işletme sahibi (Gökyüzü Hosting).

**Nerede çalışır?** Master işletmecinin kendi sunucusunda (`panel.gokyuzuhosting.com` · MASTER_IP=89.19.15.58).

**Ne yapar?**

* Lisans üretir + satar (Starter/Pro/Enterprise)
* Bayilerin panel sürümlerini yayınlar (v43.xx)
* Havale ödemelerini onaylar/reddeder
* Bayi listesi + istatistik + heartbeat izler
* Kendi WHM sunucusunda **kendi Exim log'unu** izler (kendi bayi hesabı gibi)

**Bayilere erişimi VAR MI?**

* HAYIR — bayilerin sunucularındaki panel/DB'ye doğrudan bağlanmaz
* SADECE bayilerin gönderdiği heartbeat'leri (versiyon, healt, count) alır
* İsterse "Impersonation" ile bir bayinin görüşünü SIMÜLE eder (kendi DB'sinde yaptığı okuma bayı license_key'ine göre filtrelidir)

---

## 🏪 BAYİ (Reseller) — kendi WHM sunucusu

**Kim?** Panel satın alan hosting sağlayıcı / WHM sunucu sahibi.

**Nerede çalışır?** Bayi'nin KENDİ WHM sunucusu. Docker container + KENDİ MongoDB'si.

**Ne yapar?**

* Kendi WHM'ındaki müşterilerin outbound mail'lerini filtreler
* Kendi Exim log'unu parse eder
* Kendi bulunduğu MongoDB'de kendi verilerini saklar (mail_events, quarantine, rules)
* Master'dan yalnızca kod güncellemeleri + lisans doğrulaması çeker

**Master'a erişimi VAR MI?**

* HAYIR — master DB'ye **YAZMA hakkı yok**
* Sadece `/api/version/latest` (sürüm), `/api/plugin/download` (kod), `/api/plugin/heartbeat` (canlılık) çağırır
* Bayi paneline giriş yapan kullanıcı **master paneli göremez** (URL yazsa bile 403)

---

## 🚫 Bayi'nin YAPAMAYACAKLARI (Master DB'ye Etki Yok)

Aşağıdaki işlemler bayi panelinden **ASLA** master DB'ye etki etmez:

| İşlem | Bayi Panelinde | Master DB'ye Etkisi |
|-------|----------------|---------------------|
| DB Bakım — Temizle | KENDİ container'ında çalışır | Yok (403) |
| Havale onay/red | 403 — sadece master | Yok |
| Bayi listesi | 403 — sadece master | Yok |
| Lisans üretme | 403 — sadece master | Yok |
| Fiyat/Plan config | 403 — sadece master | Yok |
| Sürüm yayınlama | 403 — sadece master | Yok |
| Global ayarlar | 403 — sadece master | Yok |
| Sistem logları | 403 — sadece master | Yok |
| Landing CMS | 403 — sadece master | Yok |

**5 katmanlı güvenlik (v43.66-67):**

1. **Backend** — `_require_master()` guard'ı endpoint'te → 403 döndür
2. **Sidebar filter** — nav item bayilerin sidebar'ında gösterilmez
3. **URL guard** — `MasterOnlyGuard` component URL'ye direkt yazılmasını "Erişim Reddedildi" sayfasına çevirir
4. **whoami server-verify** — useIsMaster hook backend'den doğrular
5. **Master IP allowlist** — MASTER_IP env eşleşmesi zorunlu (double-lock)

---

## 🌊 Bayi ↔ Master Veri Akışı

```
┌────────────────────────────────┐          ┌─────────────────────────────┐
│ MASTER panel.gokyuzuhosting.com │          │ BAYİ mail.bayihosting.com    │
│ MongoDB: master_db              │          │ MongoDB: bayi_db (kendi)     │
├────────────────────────────────┤          ├─────────────────────────────┤
│ • Lisans üret + sat             │          │ • Exim log parse             │
│ • Bayi listesi                  │          │ • Outbound filter            │
│ • Havale onay                   │          │ • Karantina yönetimi         │
│ • Sürüm yayınla                 │          │ • Kendi kullanıcıları        │
│ • Landing CMS                   │          │ • Kendi kuralları            │
└────────┬───────────────────────┘          └──────┬──────────────────────┘
         │                                          │
         │  ← heartbeat/version poll (BAYI → MASTER) │
         │                                          │
         │  → licence_active response  (MASTER → BAYI)
         │                                          │
         │  → code tarball (MASTER → BAYI)          │
         │                                          │
         │  ← bayi push (mail_events sample, gerekli)│
         │     Not: bayı isterse KİŞİSEL VERİYİ paylaşmaz
         │     Sadece anonim metric/hearbeat gönderir
         ▼
    5 katmanlı guard: her yazma isteği 403 dönebilir
```

---

## ✅ Doğru Kullanım Örneği

**Bayi WHM'ında bir müşterisi çok spam gönderiyor:**

1. Bayi kendi paneline giriyor (mail.bayihosting.com)
2. "Giden Posta" sekmesinde ilgili kullanıcıyı görüyor
3. "Sınırla" butonuyla o kullanıcıyı throttle ediyor
4. Karantina veya DB Bakım işlemi de KENDİ container'ında çalışıyor
5. **Master'ın panelinde hiçbir şey silinmiyor / değişmiyor**

**Master havale ödemesi onayı yapıyor:**

1. Master 89.19.15.58 IP'sinden panel.gokyuzuhosting.com'a giriyor
2. Header'daki "Master Aktif Et" → MS-C02AB... anahtarı ile server-verify
3. `gws_master_session` cookie'si (30 gün) alınıyor
4. Ödeme Panosu sekmesine giriyor → havale listesi 200 OK
5. **Bayi başka IP'den denese** → sidebar'da item YOK, URL yazsa "Erişim Reddedildi", API'ye curl atsa 403

---

## 🛠 Bayi Setup Adımları (Kısa)

1. Bayi WHM sunucusuna SSH ile bağlanır
2. `git clone` + `docker compose up -d` ile plugin çalıştırır → **kendi MongoDB**'sinde
3. `MASTER_LICENSE_KEY` env'e kendi lisans anahtarı yazılır
4. Sunucu boot'ta `plugin/heartbeat`'i master'a atar, master lisansı doğrular
5. Master v43.xx sürümünü yayınlayınca bayi `gws-update` ile kodu çeker

**Bayi'nin panelinde göremeyecekleri:**
* Diğer bayilerin verisi (kendi tenant scope'unda)
* Master işlemleri (17 sayfa gizli)
* Global settings, lisans üretme, ödeme onay, sürüm yayınlama

---

## 🎯 Sonuç

Bu mimari **satılabilir bir SaaS ürünü** için doğru olan yapıdır:

* Master, ürünü satar ve merkezi işleri yönetir
* Bayiler, kendi sunucularında bağımsız çalışan bir plugin alır
* Bayiler master'ı KIRAMAZ (5 katman guard)
* Bayiler birbirinin verisini GÖREMEZ (tenant isolation)
* Master, bayilerin verisini yalnızca aggregate metric olarak görür

Bu doküman güncellendikçe VERSION_NOTES'da referans alınacak.

# GökyüzüWebSpam · PHP Bridge for `gokyuzubilgisayar.com`

Bu klasör, mevcut FastAPI/React tabanlı **GökyüzüWebSpam SaaS**'ı sizin PHP tabanlı sitenize
(`gokyuzubilgisayar.com`) bağlamak için hazırlanmış minimal bir köprü içerir.

## Neyi Nasıl Bağlıyoruz?

FastAPI backend'i **REST API** sunuyor. PHP tarafında `cURL` ile bu endpoint'lere istek atarak
lisans kontrol, mail sağlık kontrolü, RBL sorgu, IP blok gibi işlemleri PHP sayfalarınızdan
tetikleyebilirsiniz.

## Kurulum

1. `gws-bridge.php` dosyasını PHP sitenizin `/lib` veya `/includes` klasörüne kopyalayın.
2. `.env.php` içinden `API_BASE` ve `LICENSE_KEY` değerlerini kendi bilgilerinizle güncelleyin.
3. Örnekleri `example-*.php` içinden alıp kendi sayfalarınıza uyarlayın.

## API_BASE

```
https://<your-saas-domain>/api
```

Preview URL'iniz: `https://<preview>.preview.emergentagent.com/api`

## Örnek Kullanım (PHP)

```php
<?php
require_once 'gws-bridge.php';

$gws = new GWSBridge();

// Lisans doğrulama
$check = $gws->verifyLicense('MS-XXXX...');
if ($check['ok']) {
  echo "Lisans aktif. " . $check['plan'];
}

// Mail sağlık kontrolü
$health = $gws->mailHealth('gokyuzubilgisayar.com');
echo "SPF: " . ($health['checks']['spf']['ok'] ? 'OK' : 'FAIL');

// RBL kontrolü
$rbl = $gws->rblCheck('89.19.15.58');
echo "Listelenmiş: " . $rbl['listed_count'] . " / " . $rbl['total'];

// IP bloklama
$gws->ipBlock('45.32.11.7', 'Manuel blok - PHP');
```

## Alternatif: iframe Embed

Basit yaklaşım için PHP sayfanıza doğrudan iframe embed edebilirsiniz:

```html
<iframe src="https://<your-saas>/panel/mail-health"
        width="100%" height="800"
        style="border:0;border-radius:8px;">
</iframe>
```

## Güvenlik Notları

- `LICENSE_KEY`'i sunucu tarafında saklayın, JS'e vermeyin.
- Public API endpoint'leri (mail-health, RBL) lisans gerektirmez.
- Sipariş/ödeme uçlarını sadece HTTPS üzerinden çağırın.
- CORS: SaaS backend'inde `CORS_ORIGINS` env'ine `gokyuzubilgisayar.com` ekleyin.

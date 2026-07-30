# GökyüzüWebSpam — License Server Cluster Deployment

Bu klasör, WHM sunucularınızdan **bağımsız** bir "license.gokyuzuwebspam.com"
host'unda çalıştıracağınız yüksek erişilebilir (HA) lisans doğrulama cluster'ının
tam üretim şablonudur.

## Mimari

```
                                Internet
                                    ↓
                              [ nginx/CDN ]  ← TLS terminator (opsiyonel, prod)
                                    ↓
                              [ HAProxy :8080 ]     ← round-robin + health check
                              /       |         \
                       [license-1] [license-2] [license-3]  ← FastAPI (scale ile 5,10..N)
                              \       |         /
                                   ↓  ↓  ↓
                    ┌────────────────────────────────┐
                    │  Redis Master ⇄ Redis Replica  │  ← verify cache + rate limit + replica keşfi
                    │           ↑                    │
                    │  Sentinel × 3 (HA failover)    │
                    └────────────────────────────────┘
                                    ↓
                              [ MongoDB ]           ← lisans veritabanı (ana backend ile paylaşılır)
```

## Hızlı Başlangıç

```bash
cd /app/deploy
export LICENSE_SERVER_ADMIN_KEY="$(openssl rand -hex 32)"
docker compose up -d
docker compose ps
```

Sağlık kontrolü:
```bash
curl http://localhost:8080/v1/health
curl http://localhost:8080/v2/cluster/health
```

HAProxy dashboard:
```
http://localhost:8404/stats
```

## Ölçekleme

License server replica sayısını değiştirmek için:
```bash
docker compose up -d --scale license=5
```

HAProxy `server-template license 5` direktifi otomatik olarak Docker DNS'ten
yeni container IP'lerini keşfeder — restart gerektirmez.

## Prod Sertleştirme

1. **TLS**: Compose önüne nginx veya Cloudflare Origin CA koyun.
2. **Redis şifresi**: `redis-master` command'ına `--requirepass "$REDIS_PASS"` ekleyin,
   ardından `LICENSE_SERVER_REDIS_URL: redis://:${REDIS_PASS}@redis-master:6379/0`.
3. **Mongo replikaset**: Compose'daki tek `mongo` yerine 3 üyeli replikaset kurun
   (production için kritik).
4. **HAProxy stats basic auth**: `stats auth admin:$(openssl rand -hex 12)`.
5. **Log agregasyonu**: `logging.driver: json-file` yerine `syslog` veya `fluentd`.
6. **Kaynak sınırları**: her servise `deploy.resources.limits` ekleyin.

## Ana Backend Yapılandırması

Ana GökyüzüWebSpam backend'inin `.env` dosyasında:
```env
PUBLIC_LICENSE_SERVER_URL=https://license.gokyuzuwebspam.com
LICENSE_SERVER_REGIONS=Cluster (HA)
LICENSE_SERVER_ADMIN_KEY=<yukarıda üretilen değer>
```

Eğer birden çok bölge çalıştırıyorsanız (örneğin EU + US):
```env
PUBLIC_LICENSE_SERVER_URL=https://eu.license.gokyuzuwebspam.com,https://us.license.gokyuzuwebspam.com
LICENSE_SERVER_REGIONS=Primary EU-West,Secondary US-East
```

## Failover Testi

```bash
# 1 replica'yı durdur
docker compose stop license
docker compose start license --scale license=2
# Ana backend automatik olarak diğer replica'ya geçer
curl -X POST https://backend.gokyuzuwebspam.com/api/license-server/verify \
     -H "Content-Type: application/json" \
     -d '{"license_key":"MS-...","server_ip":"1.2.3.4"}'
# → 200 OK, served_by: "Cluster (HA)"
```

## Kapatma

```bash
docker compose down          # veri korunur
docker compose down -v       # veri de silinir (dikkat)
```

<?php
require_once __DIR__ . '/inc/layout.php';
gws_head('Özellikler', 'GökyüzüWebSpam özellikleri: AI mail tarama, 14 RBL, exploit tespiti, spam filtreleme');
gws_nav('ozellikler');

$modules = [
    ['icon'=>'📥','name'=>'MailScanner',           'desc'=>'Milter tabanlı gelen mail tarama · AI + heuristic hybrid skorlama · anlık verdict',                   'features'=>['Gerçek zamanlı milter','AI Sonnet skorlama','Otomatik quarantine','Öğrenme (Bayes)']],
    ['icon'=>'🏥','name'=>'Mail Sağlığı',           'desc'=>'Domain SPF/DKIM/DMARC + MX check · Blacklist tarama · Health score 0-100',                       'features'=>['SPF/DKIM/DMARC audit','MX kayıt validasyonu','TLS cert check','7/24 monitoring']],
    ['icon'=>'🌐','name'=>'Tehdit Zekası',          'desc'=>'URLHaus + Spamhaus IOC feed · Otomatik enforce · Global TLD/ülke analitiği',                      'features'=>['3M+ IOC entry','Otomatik enforce','TLD reputation','Ülke bazlı block']],
    ['icon'=>'🛡️','name'=>'Güvenlik & Exploit',     'desc'=>'Webshell tarama · CMS zafiyet tespit · WP/PHP shell/backdoor imza motoru',                       'features'=>['WebShell dedektörü','WP core check','Malware YARA','İmza editörü']],
    ['icon'=>'📦','name'=>'Quarantine',             'desc'=>'Karantina yönetimi · Kullanıcı review · Toplu release/delete · Filter chain',                     'features'=>['Kullanıcı-selfservice','Toplu işlemler','Rüştür filtresi','Otomatik purge']],
    ['icon'=>'📋','name'=>'Whitelist / Blacklist',  'desc'=>'IP + Domain + E-posta listeleri · Wildcard destek · CIDR range',                                  'features'=>['CIDR range','Wildcard domain','Toplu import CSV','Otomatik senkron']],
    ['icon'=>'🔗','name'=>'RBL Delisting',           'desc'=>'14 RBL sağlayıcı otomatik kontrol · Delist request generator · SLA takibi',                     'features'=>['14 RBL check','1-tıkla delist','SLA monitoring','Otomatik retry']],
    ['icon'=>'⚙️','name'=>'Rules & Engines',        'desc'=>'Custom regex kuralları · Bayes filtreler · SpamAssassin motoru · Yönetici override',              'features'=>['Regex kuralları','Bayes learning','SA integrasyonu','Öncelik yönetimi']],
    ['icon'=>'📤','name'=>'Outbound Mail',          'desc'=>'Giden mail hız sınırı · Anomali tespiti · Compromise koruma · Rate limit',                        'features'=>['Rate limiting','Anomali dedektörü','Toplu mail alarmı','Auto suspend']],
    ['icon'=>'🔔','name'=>'Notifications & Alerts', 'desc'=>'E-posta/Slack/Telegram bildirim · Alarm kuralları · Saldırı & toplu mail alarmı',                'features'=>['E-posta alerts','Slack webhook','Alarm rules','Saldırı algılama']],
    ['icon'=>'📊','name'=>'Reports',                'desc'=>'Günlük/haftalık/aylık raporlar · Executive dashboard · PDF/CSV export',                          'features'=>['PDF raporlar','CSV export','Zamanlanmış e-posta','Compliance ready']],
    ['icon'=>'👥','name'=>'Multi-Reseller',         'desc'=>'Bayi hesapları · Master-Reseller mimarisi · Heartbeat + lisans dağıtımı',                        'features'=>['Bayi paneli','Heartbeat 15dk','Otomatik sürüm','SSO destek']],
    ['icon'=>'💳','name'=>'Akıllı POS',              'desc'=>'22 Türk ödeme sağlayıcısı · PayTR + iyzico + 14 banka VPOS · Havale otomasyon',                'features'=>['22 sağlayıcı','Failover routing','Havale eşleşme','Taksit desteği']],
    ['icon'=>'🌍','name'=>'Global Attack Map',      'desc'=>'Canlı saldırı haritası · TopoJSON dünya haritası · Ülke bazlı geo-block',                        'features'=>['Canlı harita','Geo-block','TopoJSON','30 gün trend']],
];
?>
<div class="container section">
  <div style="text-align:center; margin-bottom:48px">
    <span class="badge badge-indigo">14+ Modül</span>
    <h1 class="h1" style="margin-top:12px">Kurumsal Sınıf Mail Güvenlik Paketi</h1>
    <p class="lead" style="margin:0 auto">WHM/cPanel için üretilmiş 14+ entegre modül · AI destekli · Türkçe arayüz · Türkiye pazarına özel</p>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px">
    <?php foreach ($modules as $m): ?>
    <div class="card">
      <div style="display:flex;align-items:start;gap:12px;margin-bottom:12px">
        <div style="font-size:32px;line-height:1">
          <?= $m['icon'] ?>
        </div>
        <div style="flex:1">
          <h3 style="color:#fff;font-size:18px;font-weight:700;margin-bottom:4px"><?= htmlspecialchars($m['name']) ?></h3>
          <p style="color:#94a3b8;font-size:13px;line-height:1.5"><?= htmlspecialchars($m['desc']) ?></p>
        </div>
      </div>
      <ul style="list-style:none;padding:12px 0 0 0;border-top:1px solid rgba(148,163,184,0.10)">
        <?php foreach ($m['features'] as $f): ?>
          <li style="padding:4px 0;font-size:12px;color:#cbd5e1;display:flex;align-items:center;gap:6px">
            <span style="color:#10b981;font-weight:700">✓</span> <?= htmlspecialchars($f) ?>
          </li>
        <?php endforeach; ?>
      </ul>
    </div>
    <?php endforeach; ?>
  </div>
  <div style="text-align:center;margin-top:48px">
    <a href="fiyatlar.php" class="btn btn-primary">Fiyatları Gör →</a>
    <a href="iletisim.php" class="btn btn-outline" style="margin-left:8px">Demo İste</a>
  </div>
</div>
<?php gws_footer(); ?>

<?php
require_once __DIR__ . '/inc/layout.php';
require_once __DIR__ . '/gws-bridge.php';
gws_head('Fiyatlandırma', 'GökyüzüWebSpam paketleri: Starter, Professional, Enterprise. PayTR + Havale ödeme.');
gws_nav('fiyatlar');

$gws = new GWSBridge();
$mode = $_POST['mode'] ?? '';
$result = null;
if ($mode === 'paytr' && !empty($_POST['email'])) {
    $result = $gws->paytrCreate($_POST['email'], $_POST['name'] ?? 'Müşteri',
        [['name' => 'GökyüzüWebSpam ' . ($_POST['plan'] ?? 'starter'),
          'price' => (float)$_POST['amount'], 'qty' => 1]]);
} elseif ($mode === 'havale' && !empty($_POST['email'])) {
    $result = $gws->havaleCreate($_POST['email'], $_POST['name'] ?? 'Müşteri',
        (float)$_POST['amount'], $_POST['plan'] ?? null);
}

$plans = [
    ['id'=>'starter',    'name'=>'STARTER',      'price'=>199,  'best'=>false,
     'features'=>['5 domain','50K mail/ay','Temel spam filtre','14 RBL check','E-posta destek']],
    ['id'=>'pro',        'name'=>'PROFESSIONAL', 'price'=>499,  'best'=>true,
     'features'=>['20 domain','500K mail/ay','AI + 14 RBL','Exploit tarayıcı','Otomatik quarantine','7/24 destek']],
    ['id'=>'enterprise', 'name'=>'ENTERPRISE',   'price'=>999,  'best'=>false,
     'features'=>['Sınırsız domain','Sınırsız mail','Tüm modüller','Multi-Reseller','Özel eğitim','SLA %99.9']],
];
$nfmt = fn($n) => number_format($n ?? 0, 0, ',', '.');
?>
<div class="container section">
  <div style="text-align:center;margin-bottom:48px">
    <span class="badge badge-emerald">İlk 14 Gün Ücretsiz</span>
    <h1 class="h1" style="margin-top:12px">Şeffaf Fiyatlandırma</h1>
    <p class="lead" style="margin:0 auto">İhtiyacınıza uygun paketi seçin · TL ile fiyatlı · Anlık satın alma · Kredi kartı + Havale</p>
  </div>

  <?php if ($result): ?>
    <div class="alert <?= ($result['ok'] ?? false) ? 'alert-ok' : 'alert-err' ?>">
      <?php if (($result['ok'] ?? false) && !empty($result['iframe_src'])): ?>
        ✓ Ödeme oturumu oluşturuldu! <a href="<?= htmlspecialchars($result['iframe_src']) ?>" target="_blank" style="text-decoration:underline">→ Ödeme sayfasına git</a>
      <?php elseif (($result['ok'] ?? false) && !empty($result['iban'])): ?>
        ✓ Havale bilgisi oluşturuldu · IBAN: <span class="mono"><?= htmlspecialchars($result['iban']) ?></span> · Referans: <span class="mono"><?= htmlspecialchars($result['reference'] ?? '') ?></span>
      <?php else: ?>
        ✗ <?= htmlspecialchars($result['error'] ?? $result['detail'] ?? 'Hata oluştu') ?>
      <?php endif; ?>
    </div>
  <?php endif; ?>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px">
    <?php foreach ($plans as $p): ?>
    <div class="card" style="position:relative;<?= $p['best'] ? 'border-color:#6366f1;box-shadow:0 12px 40px -8px rgba(99,102,241,0.4);' : '' ?>">
      <?php if ($p['best']): ?>
        <div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:4px 16px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.1em">EN POPÜLER</div>
      <?php endif; ?>
      <div style="text-align:center;padding:8px 0 16px">
        <div style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:0.15em"><?= $p['name'] ?></div>
        <div style="margin-top:8px"><span style="font-size:48px;font-weight:800;color:#fff"><?= $nfmt($p['price']) ?></span><span style="color:#94a3b8;font-size:14px"> TL / ay</span></div>
      </div>
      <ul style="list-style:none;padding:16px 0;border-top:1px solid rgba(148,163,184,0.10)">
        <?php foreach ($p['features'] as $f): ?>
          <li style="padding:6px 0;font-size:14px;color:#cbd5e1;display:flex;align-items:center;gap:8px">
            <span style="color:#10b981;font-weight:700">✓</span> <?= htmlspecialchars($f) ?>
          </li>
        <?php endforeach; ?>
      </ul>
      <form method="POST" style="display:grid;gap:8px;padding-top:12px;border-top:1px solid rgba(148,163,184,0.10)">
        <input type="hidden" name="plan" value="<?= $p['id'] ?>">
        <input type="hidden" name="amount" value="<?= $p['price'] ?>">
        <input class="input" type="text" name="name" placeholder="Ad Soyad" required>
        <input class="input" type="email" name="email" placeholder="E-posta" required>
        <button type="submit" name="mode" value="paytr" class="btn btn-primary" style="width:100%;justify-content:center">💳 Kredi Kartı ile Öde</button>
        <button type="submit" name="mode" value="havale" class="btn btn-outline" style="width:100%;justify-content:center">🏦 Havale / EFT</button>
      </form>
    </div>
    <?php endforeach; ?>
  </div>

  <div style="margin-top:48px;text-align:center;color:#64748b;font-size:13px">
    Tüm paketler KDV dahildir · Fatura kesimi otomatik · Yıllık ödemede %20 indirim
  </div>
</div>
<?php gws_footer(); ?>

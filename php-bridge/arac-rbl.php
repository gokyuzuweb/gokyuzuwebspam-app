<?php
require_once __DIR__ . '/inc/layout.php';
require_once __DIR__ . '/gws-bridge.php';
gws_head('RBL Kontrol Aracı', 'IP adresinizi 14 farklı RBL sağlayıcısında ücretsiz kontrol edin');

$gws = new GWSBridge();
$ip = trim($_POST['ip'] ?? '');
$result = null;
if ($ip && filter_var($ip, FILTER_VALIDATE_IP)) {
    $result = $gws->rblCheck($ip);
}
gws_nav('rbl');
?>
<div class="container section">
  <div style="text-align:center;margin-bottom:32px">
    <span class="badge badge-indigo">Ücretsiz Araç</span>
    <h1 class="h1" style="margin-top:12px">🔍 RBL Kontrol Aracı</h1>
    <p class="lead" style="margin:0 auto">IP adresinizin 14 farklı gerçek zamanlı blacklist sağlayıcısında listelenip listelenmediğini anında kontrol edin.</p>
  </div>

  <form method="POST" style="max-width:520px;margin:0 auto 32px;display:flex;gap:8px">
    <input class="input" type="text" name="ip" placeholder="IP adresi (örn: 8.8.8.8)"
           value="<?= htmlspecialchars($ip) ?>" required style="flex:1"
           pattern="^(25[0-5]|2[0-4]\d|[01]?\d\d?)(\.(25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$">
    <button type="submit" class="btn btn-primary">🔍 Kontrol Et</button>
  </form>

  <?php if ($ip && !filter_var($ip, FILTER_VALIDATE_IP)): ?>
    <div class="alert alert-err" style="max-width:520px;margin:0 auto">✗ Geçersiz IP adresi</div>
  <?php elseif ($result): ?>
    <?php if (!empty($result['error'])): ?>
      <div class="alert alert-err" style="max-width:520px;margin:0 auto">✗ Hata: <?= htmlspecialchars($result['error']) ?></div>
    <?php else:
      $providers = $result['results'] ?? $result['providers'] ?? [];
      $listedCount = 0;
      foreach ($providers as $r) if (!empty($r['listed'])) $listedCount++;
      $total = count($providers);
    ?>
      <div style="max-width:720px;margin:0 auto">
        <div class="card" style="text-align:center;margin-bottom:20px;<?= $listedCount === 0 ? 'border-color:#10b981' : 'border-color:#f43f5e' ?>">
          <div style="font-size:48px;margin-bottom:8px"><?= $listedCount === 0 ? '✅' : '⚠️' ?></div>
          <div style="font-size:20px;font-weight:700;color:#fff">
            <?= $listedCount === 0 ? 'IP TEMİZ' : "$listedCount / $total RBL'DE LİSTELİ" ?>
          </div>
          <div style="color:#94a3b8;font-size:13px;margin-top:4px">
            <span class="mono"><?= htmlspecialchars($ip) ?></span> · <?= $total ?> sağlayıcı tarandı
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
          <?php foreach ($providers as $r): ?>
          <div class="card" style="padding:14px;<?= !empty($r['listed']) ? 'border-color:#f43f5e' : '' ?>">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div>
                <div style="font-size:13px;color:#fff;font-weight:600"><?= htmlspecialchars($r['name'] ?? $r['key'] ?? '?') ?></div>
                <div style="font-size:10px;color:#64748b" class="mono"><?= htmlspecialchars($r['zone'] ?? '') ?></div>
              </div>
              <?php if (!empty($r['listed'])): ?>
                <span class="badge" style="background:rgba(244,63,94,0.15);color:#fda4af;border:1px solid rgba(244,63,94,0.3)">LİSTELİ</span>
              <?php else: ?>
                <span class="badge badge-emerald">TEMİZ</span>
              <?php endif; ?>
            </div>
            <?php if (!empty($r['listed']) && !empty($r['reason'])): ?>
              <div style="margin-top:8px;font-size:11px;color:#94a3b8"><?= htmlspecialchars($r['reason']) ?></div>
            <?php endif; ?>
          </div>
          <?php endforeach; ?>
        </div>
        <?php if ($listedCount > 0): ?>
          <div class="alert alert-info" style="margin-top:20px">
            <strong>⚡ Delist Yardımı:</strong> Listelenmiş IP'niz için <a href="fiyatlar.php" style="text-decoration:underline">GökyüzüWebSpam</a> abonelerine otomatik delist request gönderme özelliği ücretsiz sunulur.
          </div>
        <?php endif; ?>
      </div>
    <?php endif; ?>
  <?php endif; ?>
</div>
<?php gws_footer(); ?>

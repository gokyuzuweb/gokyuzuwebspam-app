<?php
require_once __DIR__ . '/inc/layout.php';
require_once __DIR__ . '/gws-bridge.php';
gws_head('Mail Sağlığı Testi', 'Domain mail sağlığı: SPF, DKIM, DMARC, MX, TLS kontrolü');

$gws = new GWSBridge();
$domain = trim($_POST['domain'] ?? '');
$result = null;
if ($domain) {
    $result = $gws->mailHealth($domain);
}
gws_nav('mailhealth');
?>
<div class="container section">
  <div style="text-align:center;margin-bottom:32px">
    <span class="badge badge-emerald">Ücretsiz Araç</span>
    <h1 class="h1" style="margin-top:12px">🏥 Mail Sağlığı Testi</h1>
    <p class="lead" style="margin:0 auto">Domain'inizin SPF · DKIM · DMARC · MX kayıtlarını ve TLS güvenliğini kontrol edin. 0-100 sağlık puanı alın.</p>
  </div>

  <form method="POST" style="max-width:520px;margin:0 auto 32px;display:flex;gap:8px">
    <input class="input" type="text" name="domain" placeholder="Domain (örn: example.com)"
           value="<?= htmlspecialchars($domain) ?>" required style="flex:1"
           pattern="^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)+$">
    <button type="submit" class="btn btn-emerald">🏥 Test Et</button>
  </form>

  <?php if ($result && !empty($result['error'])): ?>
    <div class="alert alert-err" style="max-width:520px;margin:0 auto">✗ <?= htmlspecialchars($result['error']) ?></div>
  <?php elseif ($result):
    $score = (int)($result['score'] ?? 0);
    $tone = $score >= 80 ? '#10b981' : ($score >= 50 ? '#f59e0b' : '#f43f5e');
    $label = $score >= 80 ? 'MÜKEMMEL' : ($score >= 50 ? 'ORTA' : 'ZAYIF');
    $checks = $result['checks'] ?? [];
  ?>
    <div style="max-width:720px;margin:0 auto">
      <div class="card" style="text-align:center;margin-bottom:20px;border-color:<?= $tone ?>">
        <div style="font-size:64px;font-weight:800;color:<?= $tone ?>;line-height:1"><?= $score ?><span style="font-size:24px;color:#94a3b8">/100</span></div>
        <div style="font-size:16px;font-weight:700;color:#fff;margin-top:8px"><?= $label ?></div>
        <div style="color:#94a3b8;font-size:13px;margin-top:4px">
          <span class="mono"><?= htmlspecialchars($domain) ?></span>
        </div>
      </div>

      <div style="display:grid;gap:12px">
        <?php foreach ($checks as $ck):
          $ok = !empty($ck['ok']);
          $c = $ok ? '#10b981' : '#f43f5e';
        ?>
        <div class="card" style="padding:16px;border-color:<?= $ok ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)' ?>">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:24px;color:<?= $c ?>"><?= $ok ? '✅' : '❌' ?></div>
            <div style="flex:1">
              <div style="font-weight:700;color:#fff"><?= htmlspecialchars($ck['name'] ?? '?') ?></div>
              <div style="font-size:13px;color:#94a3b8"><?= htmlspecialchars($ck['message'] ?? $ck['desc'] ?? '') ?></div>
              <?php if (!empty($ck['record'])): ?>
                <div class="mono" style="font-size:11px;color:#64748b;margin-top:6px;padding:6px;background:rgba(2,6,23,0.5);border-radius:6px;word-break:break-all"><?= htmlspecialchars($ck['record']) ?></div>
              <?php endif; ?>
            </div>
          </div>
        </div>
        <?php endforeach; ?>
      </div>

      <?php if ($score < 80): ?>
        <div class="alert alert-info" style="margin-top:20px">
          <strong>💡 GökyüzüWebSpam ile daha iyisi mümkün:</strong> Panelimizle SPF/DKIM/DMARC ayarlarınızı otomatik yönetin, 7/24 monitör edin ve alarm alın.
          <a href="fiyatlar.php" style="text-decoration:underline;color:#a5b4fc">Detaylı bilgi →</a>
        </div>
      <?php endif; ?>
    </div>
  <?php endif; ?>
</div>
<?php gws_footer(); ?>

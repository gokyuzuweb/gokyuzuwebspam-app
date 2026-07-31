<?php
/**
 * example-mail-health.php
 * Kullanıcının domain'ini alıp SPF/DKIM/DMARC/PTR skorunu göster.
 */
require_once __DIR__ . '/gws-bridge.php';
$gws = new GWSBridge();

$domain = $_GET['domain'] ?? '';
$result = null;
if ($domain) {
    $result = $gws->mailHealth($domain);
}
?>
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>Mail Sağlık Kontrolü · GökyüzüBilgisayar</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; background: #0f172a; color: #e2e8f0; }
  input, button { padding: 10px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-size: 14px; }
  button { background: #6366f1; color: white; cursor: pointer; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 10px 0; }
  .ok { color: #10b981; } .fail { color: #f43f5e; }
  .score { font-size: 48px; font-weight: bold; color: #6366f1; }
</style>
</head>
<body>
  <h1>📧 Mail Sağlık Kontrolü</h1>
  <form method="get">
    <input type="text" name="domain" placeholder="ornek.com" value="<?= htmlspecialchars($domain) ?>" style="width: 300px">
    <button type="submit">Kontrol Et</button>
  </form>

  <?php if ($result): ?>
    <div class="card">
      <div class="score"><?= round(($result['score'] ?? 0) / max(1, $result['max_score'] ?? 100) * 100) ?>%</div>
      <?php foreach (($result['checks'] ?? []) as $k => $v): ?>
        <div>
          <strong><?= strtoupper($k) ?>:</strong>
          <span class="<?= ($v['ok'] ?? false) ? 'ok' : 'fail' ?>">
            <?= ($v['ok'] ?? false) ? '✓ OK' : '✗ FAIL' ?>
          </span>
          <?php if (!empty($v['record'])): ?><br><small><?= htmlspecialchars($v['record']) ?></small><?php endif; ?>
        </div>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <p><small>Powered by GökyüzüWebSpam SaaS · <a href="https://gokyuzuhosting.com" style="color:#6366f1">gokyuzuhosting.com</a></small></p>
</body>
</html>

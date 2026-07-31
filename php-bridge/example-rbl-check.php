<?php
/**
 * example-rbl-check.php
 * IP RBL kontrolü + delisting butonları.
 */
require_once __DIR__ . '/gws-bridge.php';
$gws = new GWSBridge();
$ip = $_GET['ip'] ?? '';
$result = $ip ? $gws->rblCheck($ip) : null;
?>
<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>RBL Reputation · GökyüzüBilgisayar</title>
<style>body{font-family:sans-serif;max-width:900px;margin:40px auto;padding:20px;background:#0f172a;color:#e2e8f0}
input,button{padding:10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0}
button{background:#6366f1;color:white;cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:20px}
td,th{padding:10px;border-bottom:1px solid #334155;text-align:left}
.listed{color:#f43f5e;font-weight:bold}.clean{color:#10b981}</style></head>
<body>
<h1>📡 RBL / DNSBL Reputation</h1>
<form method="get">
  <input name="ip" placeholder="89.19.15.58" value="<?= htmlspecialchars($ip) ?>" style="width:250px">
  <button type="submit">Kontrol Et</button>
</form>

<?php if ($result): ?>
  <h2>IP: <?= htmlspecialchars($result['ip']) ?> · Listelenmiş: <?= $result['listed_count'] ?> / <?= $result['total'] ?></h2>
  <table>
    <tr><th>Sağlayıcı</th><th>DNSBL</th><th>Durum</th><th>Delisting</th></tr>
    <?php foreach ($result['results'] as $r): ?>
      <tr>
        <td><?= htmlspecialchars($r['name']) ?></td>
        <td><small><?= htmlspecialchars($r['dnsbl']) ?></small></td>
        <td class="<?= $r['listed'] ? 'listed' : 'clean' ?>">
          <?= $r['listed'] ? '⚠️ LİSTELENMİŞ' : '✓ Temiz' ?>
        </td>
        <td>
          <?php if ($r['listed']): ?>
            <a href="<?= htmlspecialchars($r['delist_url']) ?>" target="_blank" style="color:#6366f1">Delisting →</a>
          <?php endif; ?>
        </td>
      </tr>
    <?php endforeach; ?>
  </table>
<?php endif; ?>
<p><small>Powered by GökyüzüWebSpam SaaS</small></p>
</body></html>

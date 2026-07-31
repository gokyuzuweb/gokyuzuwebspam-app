<?php
/**
 * example-checkout.php
 * PHP siteden PayTR checkout başlat + Havale bilgileri göster.
 */
require_once __DIR__ . '/gws-bridge.php';
$gws = new GWSBridge();

$mode = $_POST['mode'] ?? '';
$result = null;

if ($mode === 'paytr' && !empty($_POST['email'])) {
    $result = $gws->paytrCreate(
        $_POST['email'], $_POST['name'] ?? 'Kullanıcı',
        [['name' => $_POST['plan'] ?? 'Lisans', 'price' => (float)$_POST['amount'], 'qty' => 1]]
    );
} elseif ($mode === 'havale' && !empty($_POST['email'])) {
    $result = $gws->havaleCreate(
        $_POST['email'], $_POST['name'] ?? 'Kullanıcı',
        (float)$_POST['amount'], $_POST['plan'] ?? null
    );
}
?>
<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Ödeme · GökyüzüBilgisayar</title>
<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:20px;background:#0f172a;color:#e2e8f0}
input,select,button{padding:10px;margin:5px 0;width:100%;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;box-sizing:border-box}
button{background:#6366f1;color:white;cursor:pointer;width:auto}
.card{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:20px;margin:20px 0}
.iban{background:#0f172a;border:1px solid #10b981;color:#10b981;padding:12px;border-radius:6px;font-family:monospace;font-size:16px}</style></head>
<body>
<h1>💳 Lisans Satın Al</h1>
<form method="post">
  <label>Ad Soyad<input name="name" required></label>
  <label>E-posta<input name="email" type="email" required></label>
  <label>Plan
    <select name="plan">
      <option value="starter">Starter — 199 TL</option>
      <option value="pro">Pro — 499 TL</option>
      <option value="enterprise">Enterprise — 999 TL</option>
    </select>
  </label>
  <label>Tutar (TL)<input name="amount" type="number" value="199" required></label>
  <div style="display:flex;gap:10px;margin-top:10px">
    <button type="submit" name="mode" value="paytr">💳 Kartla Öde (PayTR)</button>
    <button type="submit" name="mode" value="havale" style="background:#10b981">🏦 Havale / EFT</button>
  </div>
</form>

<?php if ($mode === 'paytr' && !empty($result['iframe_src'])): ?>
  <div class="card">
    <h2>PayTR Ödeme Sayfası</h2>
    <?php if (!empty($result['mock'])): ?>
      <p><small>ℹ️ Test modu — canlı PayTR anahtarı yapılandırılırsa gerçek ödeme olur.</small></p>
    <?php endif; ?>
    <iframe src="<?= htmlspecialchars($result['iframe_src']) ?>" width="100%" height="600" style="border:0;background:white;border-radius:6px"></iframe>
  </div>
<?php elseif ($mode === 'havale' && !empty($result['iban'])): ?>
  <div class="card">
    <h2>🏦 Havale Bilgileri</h2>
    <p><strong>Banka:</strong> <?= htmlspecialchars($result['bank']) ?></p>
    <p><strong>Alıcı:</strong> <?= htmlspecialchars($result['beneficiary']) ?></p>
    <div class="iban"><?= htmlspecialchars($result['iban']) ?></div>
    <p><strong>Tutar:</strong> <?= $result['amount'] ?> TL</p>
    <p><strong>⚠️ Açıklama alanına şu referansı yazmayı unutmayın:</strong></p>
    <div class="iban" style="border-color:#f59e0b;color:#f59e0b"><?= htmlspecialchars($result['reference']) ?></div>
    <p><small>Ödeme doğrulandıktan sonra lisansınız 24 saat içinde e-postanıza gelir.</small></p>
  </div>
<?php elseif ($result && isset($result['error'])): ?>
  <div class="card" style="border-color:#f43f5e;color:#f43f5e">
    Hata: <?= htmlspecialchars($result['error'] ?? 'Bilinmeyen') ?>
  </div>
<?php endif; ?>

<p><small>Powered by GökyüzüWebSpam SaaS</small></p>
</body></html>

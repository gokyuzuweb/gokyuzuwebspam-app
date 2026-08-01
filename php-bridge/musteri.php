<?php
require_once __DIR__ . '/inc/layout.php';
require_once __DIR__ . '/gws-bridge.php';
gws_head('Müşteri Portalı', 'Lisans sorgulama, ödeme geçmişi, destek talebi');

$gws = new GWSBridge();
$lk = trim($_POST['license_key'] ?? '');
$data = null;
if ($lk) {
    $data = $gws->verifyLicense($lk);
}
gws_nav('musteri');
?>
<div class="container section">
  <div style="text-align:center;margin-bottom:32px">
    <span class="badge badge-amber">Müşteri Portalı</span>
    <h1 class="h1" style="margin-top:12px">📇 Lisans Sorgulama</h1>
    <p class="lead" style="margin:0 auto">Lisans anahtarınızı girin, aktif IP'lerinizi, bitiş tarihinizi ve plan bilgilerinizi görüntüleyin.</p>
  </div>

  <form method="POST" style="max-width:560px;margin:0 auto 32px;display:flex;gap:8px">
    <input class="input" type="text" name="license_key" placeholder="MS-XXXXXXXXXXXXXXXXXXXXXXXX"
           value="<?= htmlspecialchars($lk) ?>" required style="flex:1"
           pattern="^MS-[A-F0-9]{24}$" class="mono input">
    <button type="submit" class="btn btn-primary">🔍 Sorgula</button>
  </form>

  <?php if ($data && (!empty($data['ok']) || !empty($data['valid']))):
    $lic = $data['license'] ?? $data;
  ?>
    <div style="max-width:720px;margin:0 auto">
      <div class="card" style="border-color:#10b981;text-align:center">
        <div style="font-size:48px;margin-bottom:8px">✅</div>
        <div style="font-size:20px;font-weight:700;color:#fff">Lisans Aktif</div>
        <div style="color:#94a3b8;font-size:13px;margin-top:4px">
          <span class="mono"><?= htmlspecialchars($lic['license_key'] ?? $lk) ?></span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:16px">
        <div class="card"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.15em">Müşteri</div><div style="font-size:16px;color:#fff;margin-top:4px"><?= htmlspecialchars($lic['customer_name'] ?? '—') ?></div></div>
        <div class="card"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.15em">Plan</div><div style="font-size:16px;color:#a5b4fc;margin-top:4px;font-weight:700"><?= strtoupper(htmlspecialchars($lic['plan'] ?? '—')) ?></div></div>
        <div class="card"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.15em">Geçerlilik</div><div style="font-size:16px;color:#fff;margin-top:4px" class="mono"><?= htmlspecialchars(substr($lic['valid_until'] ?? '', 0, 10)) ?></div></div>
        <div class="card"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.15em">İzinli IP</div>
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
            <?php foreach (($lic['ip_addresses'] ?? []) as $ip): ?>
              <span class="mono" style="font-size:11px;padding:2px 8px;background:rgba(148,163,184,0.15);border-radius:6px;color:#cbd5e1"><?= htmlspecialchars($ip) ?></span>
            <?php endforeach; ?>
          </div>
        </div>
      </div>
    </div>
  <?php elseif ($lk): ?>
    <div class="alert alert-err" style="max-width:560px;margin:0 auto">
      ✗ Lisans bulunamadı veya geçersiz.
      <?= !empty($data['detail']) ? '<br><br><em>' . htmlspecialchars($data['detail']) . '</em>' : '' ?>
    </div>
  <?php endif; ?>

  <div style="margin-top:48px;max-width:720px;margin-left:auto;margin-right:auto">
    <h2 class="h2" style="text-align:center;margin-bottom:20px">Hızlı Yardım</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      <a href="iletisim.php" class="card" style="text-align:center;padding:20px;text-decoration:none">
        <div style="font-size:32px;margin-bottom:8px">📞</div>
        <div style="font-weight:700;color:#fff">Destek Talebi</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">Teknik ekibimize sorun bildirin</div>
      </a>
      <a href="fiyatlar.php" class="card" style="text-align:center;padding:20px;text-decoration:none">
        <div style="font-size:32px;margin-bottom:8px">⬆️</div>
        <div style="font-weight:700;color:#fff">Paket Yükselt</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">Daha fazla domain, mail hacmi</div>
      </a>
      <a href="ozellikler.php" class="card" style="text-align:center;padding:20px;text-decoration:none">
        <div style="font-size:32px;margin-bottom:8px">📚</div>
        <div style="font-weight:700;color:#fff">Dokümantasyon</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">Modül kullanım kılavuzları</div>
      </a>
    </div>
  </div>
</div>
<?php gws_footer(); ?>

<?php
/**
 * Shared layout: header + nav + footer for GökyüzüWebSpam public site
 * Tüm sayfalar bu dosyayı include eder.
 */
function gws_head($title = 'GökyüzüWebSpam', $desc = 'WHM/cPanel için kurumsal mail güvenliği · AI + 14 RBL + Exploit tarama') {
?><!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= htmlspecialchars($title) ?> · gokyuzubilgisayar.com</title>
<meta name="description" content="<?= htmlspecialchars($desc) ?>">
<meta property="og:title" content="<?= htmlspecialchars($title) ?>">
<meta property="og:description" content="<?= htmlspecialchars($desc) ?>">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    font-family: 'Manrope', -apple-system, sans-serif;
    background: #0f172a; color: #e2e8f0; line-height: 1.6;
    background-image:
      radial-gradient(circle at 15% 15%, rgba(99,102,241,0.10), transparent 55%),
      radial-gradient(circle at 85% 65%, rgba(244,63,94,0.08), transparent 55%);
  }
  .mono { font-family: 'JetBrains Mono', monospace; }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  a { color: inherit; text-decoration: none; }
  /* Nav */
  .nav {
    position: sticky; top: 0; z-index: 40;
    backdrop-filter: blur(12px);
    background: rgba(15, 23, 42, 0.85);
    border-bottom: 1px solid rgba(148,163,184,0.10);
  }
  .nav-inner {
    max-width: 1200px; margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; }
  .brand-mark {
    width: 36px; height: 36px; border-radius: 8px;
    background: linear-gradient(135deg, #6366f1, #f43f5e);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 24px -6px rgba(99,102,241,0.5);
    font-size: 18px;
  }
  .brand-name { color: #fff; }
  .brand-name .accent { color: #a5b4fc; }
  .brand-tag { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #64748b; letter-spacing: 0.15em; text-transform: uppercase; }
  .nav-links { display: flex; align-items: center; gap: 4px; }
  .nav-links a {
    padding: 8px 14px; border-radius: 8px; font-size: 14px; color: #cbd5e1;
    transition: all 0.2s;
  }
  .nav-links a:hover { background: rgba(99,102,241,0.10); color: #fff; }
  .nav-links a.active {
    background: linear-gradient(135deg, rgba(99,102,241,0.20), rgba(139,92,246,0.15));
    color: #fff;
    box-shadow: 0 0 0 1px #6366f1 inset, 0 4px 16px -4px rgba(99,102,241,0.5);
  }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 18px; border-radius: 10px;
    font-weight: 600; font-size: 14px;
    transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
    cursor: pointer; border: none;
  }
  .btn-primary {
    background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
    box-shadow: 0 8px 24px -6px rgba(99,102,241,0.5);
  }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 32px -6px rgba(99,102,241,0.65); }
  .btn-outline { border: 1px solid rgba(148,163,184,0.25); color: #cbd5e1; background: transparent; }
  .btn-outline:hover { background: rgba(99,102,241,0.08); border-color: #6366f1; color: #fff; }
  .btn-emerald {
    background: linear-gradient(135deg, #10b981, #059669); color: #fff;
    box-shadow: 0 8px 24px -6px rgba(16,185,129,0.5);
  }
  /* Cards */
  .card {
    background: rgba(15,23,42,0.6); border: 1px solid rgba(148,163,184,0.10);
    border-radius: 14px; padding: 24px;
    transition: all 0.25s;
  }
  .card:hover { border-color: rgba(99,102,241,0.35); transform: translateY(-2px); }
  /* Section */
  .section { padding: 60px 20px; }
  .h1 { font-size: clamp(28px, 4.5vw, 44px); font-weight: 800; color: #fff; line-height: 1.15; margin-bottom: 12px; }
  .h2 { font-size: clamp(22px, 3vw, 32px); font-weight: 700; color: #fff; margin-bottom: 8px; }
  .lead { color: #94a3b8; font-size: 16px; max-width: 720px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge-indigo { background: rgba(99,102,241,0.15); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3); }
  .badge-emerald { background: rgba(16,185,129,0.15); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.3); }
  .badge-amber { background: rgba(245,158,11,0.15); color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }
  /* Footer */
  .footer {
    margin-top: 80px; padding: 40px 20px 60px;
    border-top: 1px solid rgba(148,163,184,0.10);
    background: rgba(2,6,23,0.5);
  }
  .footer-grid { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 32px; }
  .footer h4 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em; color: #64748b; margin-bottom: 12px; }
  .footer a { display: block; padding: 4px 0; font-size: 13px; color: #94a3b8; }
  .footer a:hover { color: #fff; }
  .footer-bottom { max-width: 1200px; margin: 32px auto 0; padding-top: 20px; border-top: 1px solid rgba(148,163,184,0.06); text-align: center; font-size: 12px; color: #64748b; }
  /* Form controls */
  .input {
    width: 100%; padding: 10px 12px; border-radius: 8px;
    background: rgba(2,6,23,0.6); border: 1px solid rgba(148,163,184,0.15);
    color: #f1f5f9; font-size: 14px; font-family: inherit;
    transition: all 0.2s;
  }
  .input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
  .label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.05em; }
  /* Alert */
  .alert { padding: 12px 16px; border-radius: 10px; font-size: 14px; margin: 12px 0; }
  .alert-ok { background: rgba(16,185,129,0.10); border: 1px solid rgba(16,185,129,0.3); color: #86efac; }
  .alert-err { background: rgba(244,63,94,0.10); border: 1px solid rgba(244,63,94,0.3); color: #fda4af; }
  .alert-info { background: rgba(99,102,241,0.10); border: 1px solid rgba(99,102,241,0.3); color: #c7d2fe; }
  @media (max-width: 768px) {
    .nav-links a { padding: 6px 8px; font-size: 12px; }
    .footer-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>
<?php
}

function gws_nav($active = 'anasayfa') {
    $links = [
        'anasayfa'    => ['Anasayfa',     'index.php'],
        'ozellikler'  => ['Özellikler',   'ozellikler.php'],
        'fiyatlar'    => ['Fiyatlar',     'fiyatlar.php'],
        'rbl'         => ['RBL Kontrol',  'arac-rbl.php'],
        'mailhealth'  => ['Mail Sağlığı', 'arac-mailhealth.php'],
        'musteri'     => ['Müşteri Portalı', 'musteri.php'],
        'iletisim'    => ['İletişim',     'iletisim.php'],
    ];
?>
<nav class="nav">
  <div class="nav-inner">
    <a href="index.php" class="brand">
      <div class="brand-mark">🛡️</div>
      <div>
        <div class="brand-name">Gökyüzü<span class="accent">WebSpam</span></div>
        <div class="brand-tag">WHM · cPanel · v1.3</div>
      </div>
    </a>
    <div class="nav-links">
      <?php foreach ($links as $k => [$label, $href]): ?>
        <a href="<?= $href ?>" class="<?= $active === $k ? 'active' : '' ?>"><?= $label ?></a>
      <?php endforeach; ?>
    </div>
    <a href="fiyatlar.php" class="btn btn-primary">Satın Al →</a>
  </div>
</nav>
<?php
}

function gws_footer() {
?>
<footer class="footer">
  <div class="footer-grid">
    <div>
      <div class="brand" style="margin-bottom:12px">
        <div class="brand-mark">🛡️</div>
        <div>
          <div class="brand-name">Gökyüzü<span class="accent">WebSpam</span></div>
          <div class="brand-tag">gokyuzubilgisayar.com</div>
        </div>
      </div>
      <p style="font-size:13px;color:#94a3b8;max-width:320px">
        Türkiye'nin lider WHM/cPanel mail güvenlik çözümü. AI destekli tarama, 14 RBL, exploit tespiti.
      </p>
    </div>
    <div>
      <h4>Ürün</h4>
      <a href="ozellikler.php">Özellikler</a>
      <a href="fiyatlar.php">Fiyatlandırma</a>
      <a href="index.php#howitworks">Nasıl Çalışır</a>
    </div>
    <div>
      <h4>Araçlar</h4>
      <a href="arac-rbl.php">RBL Kontrol</a>
      <a href="arac-mailhealth.php">Mail Sağlığı</a>
      <a href="musteri.php">Müşteri Portalı</a>
    </div>
    <div>
      <h4>Firma</h4>
      <a href="iletisim.php">İletişim</a>
      <a href="tel:+900000000000">Telefon Destek</a>
      <a href="mailto:destek@gokyuzubilgisayar.com">E-posta</a>
    </div>
  </div>
  <div class="footer-bottom">
    © <?= date('Y') ?> Gökyüzü Bilgisayar Ltd. Şti. · Tüm hakları saklıdır ·
    <span class="mono">v1.3</span>
  </div>
</footer>
</body>
</html>
<?php
}

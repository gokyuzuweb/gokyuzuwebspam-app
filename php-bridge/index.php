<?php
/**
 * GökyüzüWebSpam · Satış Sayfası (gokyuzubilgisayar.com entegrasyonu)
 * 
 * KURULUM:
 * 1. Bu dosyayı sitenizin uygun klasörüne kopyalayın (örn: /webspam/ altına)
 * 2. gws-bridge.php ve .env.php'nin doğru path'te olduğundan emin olun
 * 3. https://gokyuzubilgisayar.com/webspam/ adresinden erişilebilir olur
 */
require_once __DIR__ . '/gws-bridge.php';
$gws = new GWSBridge();

// Canlı istatistikler
$stats = @file_get_contents(GWS_API_BASE . '/maintenance/public/blocked-stats?region=all');
$stats = $stats ? json_decode($stats, true) : [];

// Ödeme akışı
$mode = $_POST['mode'] ?? '';
$result = null;

if ($mode === 'paytr' && !empty($_POST['email'])) {
    $result = $gws->paytrCreate(
        $_POST['email'], $_POST['name'] ?? 'Müşteri',
        [['name' => 'GökyüzüWebSpam ' . ($_POST['plan'] ?? 'starter'),
          'price' => (float)$_POST['amount'], 'qty' => 1]]
    );
} elseif ($mode === 'havale' && !empty($_POST['email'])) {
    $result = $gws->havaleCreate(
        $_POST['email'], $_POST['name'] ?? 'Müşteri',
        (float)$_POST['amount'], $_POST['plan'] ?? null
    );
}

$plans = [
    ['id' => 'starter', 'name' => 'STARTER', 'price' => 199, 'best' => false,
     'features' => ['5 domain', '50K mail/ay', 'Temel spam filtre', 'E-posta destek']],
    ['id' => 'pro', 'name' => 'PROFESSIONAL', 'price' => 499, 'best' => true,
     'features' => ['20 domain', '500K mail/ay', 'AI + 14 RBL', 'Exploit tarayıcı', '7/24 destek']],
    ['id' => 'enterprise', 'name' => 'ENTERPRISE', 'price' => 999, 'best' => false,
     'features' => ['Sınırsız domain', 'Sınırsız mail', 'Tüm modüller', 'Özel eğitim', 'SLA %99.9']],
];

$nfmt = fn($n) => number_format($n ?? 0, 0, ',', '.');
require_once __DIR__ . '/inc/layout.php';
gws_head('Kurumsal Mail Güvenliği', 'WHM/cPanel için kurumsal mail güvenliği. AI + 14 RBL + Exploit tarama. TR PayTR + Havale ödeme.');
gws_nav('anasayfa');
?>
<style>
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .hero { padding: 60px 20px; text-align: center; }
  .badge {
    display: inline-block; padding: 6px 14px; border-radius: 20px;
    background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.4);
    color: #a5b4fc; font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
    margin-bottom: 24px; font-weight: 600;
  }
  h1 { font-size: 48px; line-height: 1.1; margin-bottom: 20px; font-weight: 800; }
  .grad { background: linear-gradient(135deg, #818cf8, #f472b6, #fb7185);
          -webkit-background-clip: text; background-clip: text; color: transparent; }
  .lead { font-size: 18px; color: #94a3b8; max-width: 720px; margin: 0 auto 32px; }
  .cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn {
    padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 15px;
    cursor: pointer; border: 0; text-decoration: none; display: inline-flex; align-items: center; gap: 8px;
    transition: transform .2s, box-shadow .2s;
  }
  .btn-primary { background: linear-gradient(135deg, #6366f1, #d946ef); color: white;
                 box-shadow: 0 10px 30px rgba(99,102,241,0.35); }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(99,102,241,0.5); }
  .btn-secondary { background: rgba(148,163,184,0.1); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.2); }

  /* Live metrics */
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;
             max-width: 900px; margin: 40px auto; }
  .metric { padding: 16px; border-radius: 10px; border: 1px solid; text-align: left; }
  .metric .label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.7; }
  .metric .value { font-size: 28px; font-weight: 800; margin: 4px 0; font-family: monospace; }
  .metric .hint { font-size: 10px; opacity: 0.5; }
  .m-rose    { border-color: rgba(244,63,94,0.3); background: rgba(244,63,94,0.05); color: #fecdd3; }
  .m-orange  { border-color: rgba(251,146,60,0.3); background: rgba(251,146,60,0.05); color: #fed7aa; }
  .m-amber   { border-color: rgba(251,191,36,0.3); background: rgba(251,191,36,0.05); color: #fde68a; }
  .m-fuchsia { border-color: rgba(232,121,249,0.3); background: rgba(232,121,249,0.05); color: #f5d0fe; }
  .m-indigo  { border-color: rgba(129,140,248,0.3); background: rgba(129,140,248,0.05); color: #c7d2fe; }
  .m-cyan    { border-color: rgba(103,232,249,0.3); background: rgba(103,232,249,0.05); color: #a5f3fc; }
  .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
              animation: pulse 1.5s infinite; margin-right: 6px; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  /* Pricing */
  .pricing { padding: 60px 20px; }
  h2 { font-size: 36px; text-align: center; margin-bottom: 40px; font-weight: 800; }
  .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; max-width: 1000px; margin: 0 auto; }
  .plan { background: rgba(30,41,59,0.6); border: 1px solid rgba(51,65,85,0.6); border-radius: 16px; padding: 30px; position: relative; }
  .plan.best { border-color: #6366f1; box-shadow: 0 0 40px rgba(99,102,241,0.2); transform: scale(1.03); }
  .plan.best::before { content: 'ÖNERİLEN'; position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
                       background: linear-gradient(135deg, #6366f1, #d946ef); color: white; padding: 4px 16px;
                       border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 2px; }
  .plan-name { font-size: 14px; letter-spacing: 3px; color: #94a3b8; margin-bottom: 8px; }
  .plan-price { font-size: 42px; font-weight: 800; margin-bottom: 20px; }
  .plan-price span { font-size: 14px; color: #94a3b8; font-weight: 400; }
  .plan ul { list-style: none; margin-bottom: 24px; }
  .plan li { padding: 8px 0; color: #cbd5e1; font-size: 14px; }
  .plan li::before { content: '✓'; color: #10b981; margin-right: 8px; font-weight: bold; }

  /* Checkout */
  .checkout { padding: 60px 20px; background: rgba(15,23,42,0.4); border-top: 1px solid rgba(51,65,85,0.3); }
  .checkout-grid { max-width: 900px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
  @media(max-width:768px) { .checkout-grid { grid-template-columns: 1fr; } h1 { font-size: 32px; } .plan.best { transform: none; } }
  .form-card, .result-card { background: rgba(30,41,59,0.5); border: 1px solid rgba(51,65,85,0.4); border-radius: 12px; padding: 24px; }
  label { display: block; margin-bottom: 14px; }
  label small { display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1.5px; }
  input, select { width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid #334155;
                  border-radius: 6px; color: #e2e8f0; font-size: 14px; }
  input:focus, select:focus { outline: none; border-color: #6366f1; }
  .method-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
  .method-tabs button { flex: 1; padding: 10px; background: #1e293b; border: 1px solid #334155;
                        border-radius: 6px; color: #94a3b8; cursor: pointer; font-size: 14px; }
  .method-tabs button.active { background: #6366f1; color: white; border-color: #6366f1; }
  .iban-box { padding: 14px; background: #0f172a; border: 1px solid #10b981;
              border-radius: 6px; font-family: monospace; color: #10b981; margin: 8px 0; font-size: 16px; letter-spacing: 1px; }
  footer { text-align: center; padding: 40px 20px; color: #64748b; font-size: 12px; border-top: 1px solid rgba(51,65,85,0.3); }
</style>
</head>
<body>
  <div class="hero">
    <div class="container">
      <div class="badge">🇹🇷 KURUMSAL MAIL GÜVENLİĞİ · v2.6.0</div>
      <h1>WHM/cPanel için <span class="grad">akıllı spam koruması</span></h1>
      <p class="lead">
        AI destekli 20+ modül · 14 RBL · Exploit tarayıcı · Havale + Sanal POS · Türkçe destek
      </p>

      <?php if (!empty($stats['today_blocked'])): ?>
      <div class="metrics">
        <div class="metric m-rose">
          <div class="label"><span class="live-dot"></span>Bugün Engellenen</div>
          <div class="value"><?= $nfmt($stats['today_blocked']) ?></div>
          <div class="hint">mail · %<?= $stats['block_rate'] ?? 0 ?> oran</div>
        </div>
        <div class="metric m-orange">
          <div class="label">Toplam</div>
          <div class="value"><?= $nfmt($stats['all_time_blocked']) ?></div>
          <div class="hint">tüm zamanlar</div>
        </div>
        <div class="metric m-amber">
          <div class="label">Virüs</div>
          <div class="value"><?= $nfmt($stats['virus_caught_all_time'] ?? 0) ?></div>
          <div class="hint">ClamAV + AI</div>
        </div>
        <div class="metric m-fuchsia">
          <div class="label">Phishing</div>
          <div class="value"><?= $nfmt($stats['phishing_caught_all_time'] ?? 0) ?></div>
          <div class="hint">AI destekli</div>
        </div>
        <div class="metric m-rose">
          <div class="label">Exploit</div>
          <div class="value"><?= $nfmt($stats['exploits_caught'] ?? 0) ?></div>
          <div class="hint"><?= $stats['exploits_critical'] ?? 0 ?> kritik</div>
        </div>
        <div class="metric m-indigo">
          <div class="label">Bloklu IP</div>
          <div class="value"><?= $nfmt($stats['ips_blocked'] ?? 0) ?></div>
          <div class="hint">kalıcı liste</div>
        </div>
        <div class="metric m-cyan">
          <div class="label">Karantina</div>
          <div class="value"><?= $nfmt($stats['quarantined_today'] ?? 0) ?></div>
          <div class="hint">bugün</div>
        </div>
        <div class="metric m-fuchsia">
          <div class="label">IOC</div>
          <div class="value"><?= $nfmt($stats['iocs_tracked'] ?? 0) ?></div>
          <div class="hint">tehdit istihbaratı</div>
        </div>
      </div>
      <?php endif; ?>

      <div class="cta-row">
        <a href="#checkout" class="btn btn-primary">💳 Hemen Satın Al</a>
        <a href="https://gokyuzuhosting.com" target="_blank" class="btn btn-secondary">🌐 Demo İncele</a>
      </div>
    </div>
  </div>

  <div class="pricing">
    <div class="container">
      <h2>Planlar</h2>
      <div class="plans">
        <?php foreach ($plans as $p): ?>
        <div class="plan <?= $p['best'] ? 'best' : '' ?>">
          <div class="plan-name"><?= $p['name'] ?></div>
          <div class="plan-price"><?= $p['price'] ?> TL <span>/ay</span></div>
          <ul><?php foreach ($p['features'] as $f): ?><li><?= htmlspecialchars($f) ?></li><?php endforeach; ?></ul>
          <a href="#checkout" onclick="document.getElementById('plan').value='<?= $p['id'] ?>';document.getElementById('amount').value='<?= $p['price'] ?>';"
             class="btn btn-primary" style="width: 100%; justify-content: center;">Seç</a>
        </div>
        <?php endforeach; ?>
      </div>
    </div>
  </div>

  <div class="checkout" id="checkout">
    <div class="container">
      <h2>Satın Al</h2>
      <div class="checkout-grid">
        <div class="form-card">
          <div class="method-tabs">
            <button type="button" class="active" id="tab-paytr" onclick="switchMethod('paytr')">💳 Kartla Öde (PayTR)</button>
            <button type="button" id="tab-havale" onclick="switchMethod('havale')">🏦 Havale/EFT</button>
          </div>
          <form method="post">
            <input type="hidden" name="mode" id="mode" value="paytr"/>
            <label><small>Ad Soyad</small>
              <input name="name" required value="<?= htmlspecialchars($_POST['name'] ?? '') ?>"></label>
            <label><small>E-posta</small>
              <input name="email" type="email" required value="<?= htmlspecialchars($_POST['email'] ?? '') ?>"></label>
            <label><small>Plan</small>
              <select name="plan" id="plan">
                <?php foreach ($plans as $p): ?>
                <option value="<?= $p['id'] ?>" <?= ($_POST['plan'] ?? '') === $p['id'] ? 'selected' : '' ?>>
                  <?= $p['name'] ?> · <?= $p['price'] ?> TL
                </option>
                <?php endforeach; ?>
              </select></label>
            <label><small>Tutar (TL)</small>
              <input name="amount" id="amount" type="number" required
                     value="<?= htmlspecialchars($_POST['amount'] ?? '499') ?>"></label>
            <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;" id="submit-btn">
              💳 Öde
            </button>
          </form>
        </div>

        <div class="result-card">
          <?php if ($mode === 'paytr' && !empty($result['iframe_src'])): ?>
            <div style="font-size: 14px; margin-bottom: 12px;">✓ PayTR güvenli ödeme sayfası:</div>
            <iframe src="<?= htmlspecialchars($result['iframe_src']) ?>" width="100%" height="500"
                    style="border: 0; background: white; border-radius: 6px;"></iframe>
            <?php if (!empty($result['mock'])): ?>
            <small style="color: #f59e0b;">ℹ️ Test modu — canlı PayTR anahtarı yapılandırılırsa gerçek ödeme.</small>
            <?php endif; ?>
          <?php elseif ($mode === 'havale' && !empty($result['iban'])): ?>
            <div style="color: #10b981; font-weight: bold; margin-bottom: 16px;">✓ Havale Bilgileri Hazır</div>
            <div style="font-size: 13px; color: #cbd5e1;">
              <div><strong>Banka:</strong> <?= htmlspecialchars($result['bank']) ?></div>
              <div><strong>Alıcı:</strong> <?= htmlspecialchars($result['beneficiary']) ?></div>
              <div style="margin: 8px 0;"><strong>IBAN:</strong></div>
              <div class="iban-box"><?= htmlspecialchars($result['iban']) ?></div>
              <div><strong>Tutar:</strong> <?= $result['amount'] ?> TL</div>
              <div style="margin: 8px 0;"><strong>Açıklama alanına yazın:</strong></div>
              <div class="iban-box" style="border-color: #f59e0b; color: #f59e0b;"><?= htmlspecialchars($result['reference']) ?></div>
              <p style="margin-top: 16px; color: #94a3b8; font-size: 12px;">
                Ödeme doğrulandıktan sonra lisansınız 24 saat içinde e-postanıza gelir.
              </p>
            </div>
          <?php else: ?>
            <div style="text-align: center; padding: 60px 20px; color: #64748b;">
              <div style="font-size: 48px; margin-bottom: 12px;">💳</div>
              <div>Bilgileri girin, ödeme sayfası burada açılacak</div>
            </div>
          <?php endif; ?>
        </div>
      </div>
    </div>
  </div>

  <footer>
    <div>© <?= date('Y') ?> Gökyüzü Bilgisayar Ltd. Şti. · <a href="https://gokyuzubilgisayar.com" style="color: #6366f1;">gokyuzubilgisayar.com</a> · <a href="https://gokyuzuhosting.com" style="color: #6366f1;">gokyuzuhosting.com</a></div>
    <div style="margin-top: 8px;">SaaS Panel: <a href="<?= GWS_API_BASE ?>" style="color: #6366f1;"><?= GWS_API_BASE ?></a></div>
  </footer>

  <script>
    function switchMethod(m) {
      document.getElementById('mode').value = m;
      document.getElementById('tab-paytr').classList.toggle('active', m === 'paytr');
      document.getElementById('tab-havale').classList.toggle('active', m === 'havale');
      document.getElementById('submit-btn').textContent = m === 'paytr' ? '💳 Kartla Öde' : '🏦 Havale Talebi Oluştur';
    }
    // Plan seçimi tutarı otomatik ayarlasın
    document.getElementById('plan').addEventListener('change', function() {
      const prices = <?= json_encode(array_combine(array_column($plans, 'id'), array_column($plans, 'price'))) ?>;
      document.getElementById('amount').value = prices[this.value];
    });
    // Live counter refresh (5sn)
    setInterval(async () => {
      try {
        const r = await fetch('<?= GWS_API_BASE ?>/maintenance/public/blocked-stats?region=all');
        const d = await r.json();
        document.querySelectorAll('.metric .value').forEach((el, i) => {
          const keys = ['today_blocked','all_time_blocked','virus_caught_all_time','phishing_caught_all_time',
                        'exploits_caught','ips_blocked','quarantined_today','iocs_tracked'];
          if (d[keys[i]] != null) el.textContent = new Intl.NumberFormat('tr-TR').format(d[keys[i]]);
        });
      } catch(e) {}
    }, 5000);
  </script>
<?php gws_footer(); ?>

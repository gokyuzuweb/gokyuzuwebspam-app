<?php
require_once __DIR__ . '/inc/layout.php';
gws_head('İletişim', 'GökyüzüWebSpam destek: telefon, e-posta, teknik yardım');

$msg = '';
$err = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim($_POST['name'] ?? '');
    $email = trim($_POST['email'] ?? '');
    $subj = trim($_POST['subject'] ?? '');
    $body = trim($_POST['message'] ?? '');
    if ($name && $email && $body && filter_var($email, FILTER_VALIDATE_EMAIL)) {
        // Basit dosya loglama (gerçek üretimde bir SMTP veya CRM'e yönlendir)
        $log = date('c') . " | $name <$email> | $subj\n$body\n----\n";
        @file_put_contents(__DIR__ . '/inc/contact-log.txt', $log, FILE_APPEND);
        $msg = 'Mesajınız iletildi. En kısa sürede size dönüş yapacağız.';
    } else {
        $err = 'Lütfen tüm alanları doğru doldurun (e-posta geçerli olmalı).';
    }
}
gws_nav('iletisim');
?>
<div class="container section">
  <div style="text-align:center;margin-bottom:32px">
    <span class="badge badge-indigo">7/24 Destek</span>
    <h1 class="h1" style="margin-top:12px">📞 İletişim</h1>
    <p class="lead" style="margin:0 auto">Teknik destek, satış, bayilik veya özel geliştirme talepleriniz için bizimle iletişime geçin.</p>
  </div>

  <div style="display:grid;grid-template-columns:1fr 2fr;gap:32px;max-width:1000px;margin:0 auto">
    <div>
      <div class="card" style="margin-bottom:12px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.15em">Telefon</div>
        <div style="font-size:18px;color:#fff;margin-top:4px;font-weight:700" class="mono">+90 (000) 000 00 00</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">Hafta içi 09:00-18:00</div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.15em">E-posta</div>
        <div style="font-size:16px;color:#fff;margin-top:4px" class="mono">destek@gokyuzubilgisayar.com</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">4 saat içinde yanıt</div>
      </div>
      <div class="card">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.15em">Adres</div>
        <div style="font-size:14px;color:#cbd5e1;margin-top:6px">Gökyüzü Bilgisayar Ltd. Şti.<br>Türkiye</div>
      </div>
    </div>
    <div class="card">
      <?php if ($msg): ?>
        <div class="alert alert-ok"><?= htmlspecialchars($msg) ?></div>
      <?php endif; ?>
      <?php if ($err): ?>
        <div class="alert alert-err"><?= htmlspecialchars($err) ?></div>
      <?php endif; ?>
      <form method="POST" style="display:grid;gap:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="label" for="name">Ad Soyad</label>
            <input class="input" type="text" name="name" required value="<?= htmlspecialchars($_POST['name'] ?? '') ?>">
          </div>
          <div>
            <label class="label" for="email">E-posta</label>
            <input class="input" type="email" name="email" required value="<?= htmlspecialchars($_POST['email'] ?? '') ?>">
          </div>
        </div>
        <div>
          <label class="label">Konu</label>
          <select class="input" name="subject">
            <option>Genel Bilgi</option>
            <option>Teknik Destek</option>
            <option>Satış Sorusu</option>
            <option>Bayilik Başvurusu</option>
            <option>Özel Geliştirme</option>
          </select>
        </div>
        <div>
          <label class="label">Mesaj</label>
          <textarea class="input" name="message" rows="6" required style="resize:vertical;min-height:120px"><?= htmlspecialchars($_POST['message'] ?? '') ?></textarea>
        </div>
        <button type="submit" class="btn btn-primary" style="justify-content:center">📨 Gönder</button>
      </form>
    </div>
  </div>
</div>
<?php gws_footer(); ?>

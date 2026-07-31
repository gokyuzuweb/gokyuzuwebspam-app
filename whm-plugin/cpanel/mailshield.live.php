<?php
/**
 * GokyuzuWebSpam MailControl - cPanel end-user plugin
 *
 * Displays the user's quarantine + per-user whitelist/blacklist.
 * Frontend iframe is fetched from public panel URL; auth carried by cPanel session.
 */

require_once "/usr/local/cpanel/php/cpanel.php";
$cpanel = new CPANEL();
print $cpanel->header("GokyuzuWebSpam MailControl");

$user      = getenv('REMOTE_USER') ?: 'unknown';
$publicUrl = getenv('MAILSHIELD_PUBLIC') ?: 'https://mailscanner-pro.preview.emergentagent.com';
$panelUrl  = $publicUrl . '/panel?scope=user&user=' . urlencode($user);
?>

<div class="body-content" style="padding: 12px 18px;">
  <h1 style="color:#1e3a8a; margin:0 0 6px 0;">GokyuzuWebSpam MailControl</h1>
  <p style="color:#666; margin:0 0 14px 0; font-size:13px;">
    Bu arayuz, <code><?php echo htmlspecialchars($user); ?></code> hesabinizin karantina,
    beyaz ve kara listelerini yonetmenize olanak saglar.
  </p>
  <iframe
    src="<?php echo htmlspecialchars($panelUrl); ?>"
    style="width:100%; height:calc(100vh - 260px); min-height:520px; border:0; border-radius:8px; box-shadow:0 1px 4px rgba(0,0,0,.08);">
  </iframe>
</div>

<?php print $cpanel->footer(); ?>

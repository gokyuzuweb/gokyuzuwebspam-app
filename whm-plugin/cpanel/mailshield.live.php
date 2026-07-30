<?php
/**
 * GökyüzüWebSpam MailControl — cPanel end-user plugin
 *
 * Displays the user's quarantine + per-user whitelist/blacklist.
 * Uses the local GökyüzüWebSpam API scoped to the currently-authenticated cPanel user.
 */

require_once "/usr/local/cpanel/php/cpanel.php";
$cpanel = new CPANEL();
print $cpanel->header("GökyüzüWebSpam MailControl");

$user  = getenv('REMOTE_USER') ?: 'unknown';
$apiJs = "/usr/local/mailshield/api/index.html?scope=user&user=" . urlencode($user);
?>

<div class="body-content">
  <h1>GökyüzüWebSpam MailControl</h1>
  <p>
    Bu arayüz, <code><?php echo htmlspecialchars($user); ?></code> hesabınıza gelen
    e-postaların karantina, beyaz ve kara listelerini yönetmenize olanak sağlar.
  </p>
  <iframe
    src="<?php echo htmlspecialchars($apiJs); ?>"
    style="width:100%; height:calc(100vh - 220px); border:0; border-radius:8px;">
  </iframe>
</div>

<?php print $cpanel->footer(); ?>

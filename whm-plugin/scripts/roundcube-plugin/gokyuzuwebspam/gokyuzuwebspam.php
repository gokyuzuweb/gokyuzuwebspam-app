<?php
/**
 * GökyüzüWebSpam — Roundcube Plugin (v44.00.49)
 *
 * Amaç: cPanel Roundcube webmail'e giriş yapan kullanıcıya
 * "son 24 saatte size X zararlı e-posta engellendi" toast göstermek.
 *
 * Nasıl çalışır:
 *   1. Roundcube boot sırasında bu plugin `webmail-toast.js`'i output'a ekler
 *   2. Kullanıcı email adresini `env.username` olarak set eder (JS okur)
 *   3. Panel URL'ini `env.gws_panel_url` olarak set eder
 *
 * Kurulum: install.sh otomatik olarak
 *   /usr/local/cpanel/base/3rdparty/roundcube/plugins/gokyuzuwebspam/
 *   altına kopyalar ve Roundcube config'e plugin listesine ekler.
 */
class gokyuzuwebspam extends rcube_plugin
{
    public $task = 'mail|login';

    function init()
    {
        $rcmail = rcmail::get_instance();

        // Sadece mail task'inde ve giris yapmis kullanicida calis
        if ($rcmail->task != 'mail') {
            return;
        }
        if (!$rcmail->user || !$rcmail->user->ID) {
            return;
        }

        $this->load_config();

        // Panel URL'ini env'e enjekte et
        $panel_url = $rcmail->config->get('gws_panel_url', 'https://panel.gokyuzuhosting.com');
        $rcmail->output->set_env('gws_panel_url', $panel_url);

        // Kullanici email'ini env.username olarak set et (JS bunu okur)
        $username = $rcmail->get_user_email();
        if ($username && strpos($username, '@') !== false) {
            $rcmail->output->set_env('gws_user_email', $username);
        }

        // JS script'i include et
        $this->include_script('webmail-toast.js');
    }
}

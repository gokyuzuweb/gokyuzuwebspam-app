<?php
/**
 * GökyüzüWebSpam · PHP Bridge
 * Bu sınıf FastAPI backend'e cURL ile bağlanır.
 * Kullanım: bkz. example-*.php
 */

if (!defined('GWS_API_BASE')) {
    require_once __DIR__ . '/.env.php';
}

class GWSBridge {
    private $base;
    private $licenseKey;
    private $timeout;

    public function __construct($base = null, $licenseKey = null, $timeout = 30) {
        $this->base = rtrim($base ?: GWS_API_BASE, '/');
        $this->licenseKey = $licenseKey ?: GWS_LICENSE_KEY;
        $this->timeout = $timeout;
    }

    private function request($method, $path, $data = null, $query = []) {
        $url = $this->base . $path;
        if (!empty($query)) {
            $url .= (strpos($url, '?') === false ? '?' : '&') . http_build_query($query);
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
                'User-Agent: GWSPhpBridge/1.0',
            ],
        ]);
        if ($data !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data, JSON_UNESCAPED_UNICODE));
        }
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            return ['ok' => false, 'error' => $err, 'http' => 0];
        }
        $json = json_decode($body, true);
        return $json ?: ['ok' => false, 'error' => 'Invalid JSON', 'http' => $code, 'raw' => $body];
    }

    // ---- Lisans ----
    public function verifyLicense($licenseKey = null) {
        return $this->request('POST', '/plugin/verify-license', [
            'license_key' => $licenseKey ?: $this->licenseKey,
        ]);
    }

    public function updateCheck($currentVersion = '1.0.0') {
        return $this->request('GET', '/threat-intel/update/check', null,
            ['version' => $currentVersion]);
    }

    public function updateVersions() {
        return $this->request('GET', '/threat-intel/update/versions');
    }

    // ---- Mail Health & RBL ----
    public function mailHealth($domain) {
        return $this->request('POST', '/threat-intel/mail/health-check', ['domain' => $domain]);
    }

    public function rblCheck($ip) {
        return $this->request('POST', '/threat-intel/rbl/check', ['ip' => $ip]);
    }

    public function rblProviders() {
        return $this->request('GET', '/threat-intel/rbl/providers');
    }

    public function rblDelist($ip, $providerKey, $contactEmail, $reason = '') {
        return $this->request('POST', '/threat-intel/rbl/delist', [
            'ip' => $ip, 'provider_key' => $providerKey,
            'contact_email' => $contactEmail, 'reason' => $reason,
        ]);
    }

    // ---- Threat Intel ----
    public function iocList($params = []) {
        return $this->request('GET', '/threat-intel/ioc', null, $params);
    }

    public function iocAdd($type, $value, $tag = 'spam', $confidence = 80) {
        return $this->request('POST', '/threat-intel/ioc', [
            'type' => $type, 'value' => $value,
            'tag' => $tag, 'confidence' => $confidence,
        ]);
    }

    // ---- IP Block ----
    public function ipBlock($ip, $reason = '') {
        return $this->request('POST', '/maintenance/ip/block', [
            'ip' => $ip, 'reason' => $reason,
            'license_key' => $this->licenseKey,
        ]);
    }

    public function ipUnblock($ip) {
        return $this->request('POST', '/maintenance/ip/unblock', ['ip' => $ip]);
    }

    public function ipStatus($ip) {
        return $this->request('GET', '/maintenance/ip/status', null, ['ip' => $ip]);
    }

    // ---- Mail Events ----
    public function liveEvents($limit = 50, $verdict = null) {
        $params = ['license_key' => $this->licenseKey, 'limit' => $limit];
        if ($verdict) $params['verdict'] = $verdict;
        return $this->request('GET', '/events', null, $params);
    }

    public function eventsSummary() {
        return $this->request('GET', '/events/summary', null,
            ['license_key' => $this->licenseKey]);
    }

    // ---- Payments (PayTR + Havale) ----
    public function paymentConfig() {
        return $this->request('GET', '/payments/config');
    }

    public function paytrCreate($email, $userName, $items, $userAddress = 'Türkiye', $userPhone = '05555555555') {
        return $this->request('POST', '/payments/paytr/create', [
            'email' => $email, 'user_name' => $userName,
            'user_address' => $userAddress, 'user_phone' => $userPhone,
            'items' => $items, 'test_mode' => 1, 'lang' => 'tr',
        ]);
    }

    public function havaleCreate($email, $userName, $amount, $plan = null, $note = '') {
        return $this->request('POST', '/payments/havale/create', [
            'email' => $email, 'user_name' => $userName,
            'amount' => $amount, 'plan' => $plan, 'note' => $note,
        ]);
    }

    // ---- DB Maintenance ----
    public function dbUsage() {
        return $this->request('GET', '/maintenance/db-usage');
    }
}

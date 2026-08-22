"""v44.00.06 — Feature Flag Validation Regression

Bu test suite'i şunu doğrular:
  Her `feature="..."` anahtarı hem frontend App.js `<Route feature=...>` içinde
  hem backend `PLAN_FEATURES_DEFAULT` matrix'inde tanımlı olmalı. Aksi halde
  müşteri "paket bulunmuyor" hatası alır (v44.00.05'te enterprise'ta yaşandı).

Regresyonu şu senaryoda önler:
  1. Ajan yeni bir sayfa ekler → App.js'e `feature="new_feature"` yazar
  2. Backend matrix'e eklemeyi UNUTUR
  3. Müşteri sayfayı açar → `_require_feature('new_feature')` 403 döner
"""
from __future__ import annotations
import re
from pathlib import Path

APP_JS = Path("/app/frontend/src/App.js")
SERVER_PY = Path("/app/backend/server.py")
PLAN_CONFIG_JS = Path("/app/frontend/src/pages/PlanConfig.js")


def _extract_frontend_feature_keys() -> set[str]:
    """App.js içindeki PG(Component, 'feature_key', 'label') çağrılarından
    ikinci parametre stringleri ayıkla."""
    content = APP_JS.read_text(encoding="utf-8")
    # PG( ComponentName , "feature_key" , ...
    # ve MO(...) — bunlar master-only, feature flag gerektirmiyor
    keys = set()
    for m in re.finditer(r"PG\(\s*\w+\s*,\s*['\"]([a-z0-9_]+)['\"]\s*,", content):
        keys.add(m.group(1))
    return keys


def _extract_backend_feature_keys() -> dict[str, set[str]]:
    """PLAN_FEATURES_DEFAULT dict'inden her planın key setini ayıkla."""
    content = SERVER_PY.read_text(encoding="utf-8")
    m = re.search(r"PLAN_FEATURES_DEFAULT\s*=\s*\{(.*?)\n\}\s*\n", content, re.DOTALL)
    assert m, "PLAN_FEATURES_DEFAULT bulunamadı"
    body = m.group(1)
    # 3 plan bloğunu ayır — her biri "plan_code": { ... },
    plans = {}
    for plan_name in ("starter", "pro", "enterprise"):
        plan_m = re.search(
            rf'"{plan_name}"\s*:\s*\{{(.*?)\n\s*"label":\s*"[^"]+",\s*\}}',
            body,
            re.DOTALL,
        )
        if plan_m:
            block = plan_m.group(1)
            keys = set(re.findall(r'"([a-z0-9_]+)"\s*:\s*(?:True|False|\d)', block))
            plans[plan_name] = keys
    return plans


def _extract_planconfig_feature_keys() -> set[str]:
    """PlanConfig.js FEATURE_GROUPS içindeki key: 'xxx' → xxx setleri."""
    content = PLAN_CONFIG_JS.read_text(encoding="utf-8")
    return set(re.findall(r'\bkey:\s*"([a-z0-9_]+)"', content))


class TestFeatureFlagConsistency:
    """v44.00.06 — Every frontend feature key MUST exist in backend PLAN_FEATURES."""

    def test_every_app_js_feature_exists_in_backend_matrix(self):
        frontend_keys = _extract_frontend_feature_keys()
        assert frontend_keys, "App.js'de PG(...) çağrısı bulunamadı — regex bozuk"
        backend = _extract_backend_feature_keys()
        assert "starter" in backend and "pro" in backend and "enterprise" in backend, \
            "PLAN_FEATURES_DEFAULT'te 3 plan da olmalı"
        starter_keys = backend["starter"]
        missing = frontend_keys - starter_keys
        assert not missing, (
            f"App.js'de kullanılan ama backend matrix'inde OLMAYAN feature key'ler: {missing}\n"
            f"Fix: /app/backend/server.py PLAN_FEATURES_DEFAULT içine bu key'leri ekle "
            f"(en az starter'da hepsi bool olarak tanımlı olmalı)."
        )

    def test_enterprise_plan_has_all_features(self):
        """Enterprise planı en az starter'ın tüm feature'larına sahip olmalı
        (starter'da açık ama enterprise'da eksik feature OLMAMALI)."""
        backend = _extract_backend_feature_keys()
        starter = backend["starter"]
        enterprise = backend["enterprise"]
        missing = starter - enterprise
        assert not missing, (
            f"Enterprise planında EKSİK feature key'ler: {missing}\n"
            f"Enterprise HER feature'ı desteklemeli (kullanıcı ödemiş, hepsi açık olmalı)."
        )

    def test_planconfig_js_ui_matches_backend(self):
        """PlanConfig.js Master UI'sindaki her feature backend matrix'te olmalı
        (aksi halde toggle çalışmaz)."""
        ui_keys = _extract_planconfig_feature_keys()
        backend_keys = _extract_backend_feature_keys()["starter"]
        # PlanConfig'te var ama matrix'te yok olanlar
        missing = ui_keys - backend_keys
        assert not missing, (
            f"PlanConfig.js UI'sında var ama backend matrix'te OLMAYAN key'ler: {missing}"
        )

    def test_all_three_plans_have_same_key_set(self):
        """Starter, Pro, Enterprise aynı feature key set'ine sahip olmalı
        (sadece True/False değerleri farklı olabilir). Eksik anahtar =
        `_require_feature()` fallback davranışı belirsizleşir."""
        backend = _extract_backend_feature_keys()
        starter, pro, enterprise = backend["starter"], backend["pro"], backend["enterprise"]
        all_keys = starter | pro | enterprise
        for plan_name, plan_keys in [("starter", starter), ("pro", pro), ("enterprise", enterprise)]:
            missing = all_keys - plan_keys
            assert not missing, (
                f"'{plan_name}' planında eksik: {missing}\n"
                f"3 planın da aynı key setine sahip olması gerekiyor."
            )

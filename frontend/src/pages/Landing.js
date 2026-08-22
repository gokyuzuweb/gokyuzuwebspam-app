import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ShieldAlert, ShieldCheck, Zap, Brain, Globe2, Radar, ArrowRight,
  CheckCircle2, Sparkles, Terminal, Server, Lock, Cpu, Mail, Activity,
  BadgeCheck, Rocket, CreditCard, Building2, Copy, HeartPulse, Bug,
  Globe, Database, Filter, FileText, MailCheck, Inbox,
} from "lucide-react";
import { Badge } from "@/components/ui-primitives";
import GeoBlockedHeatmap from "@/components/GeoBlockedHeatmap";
import LiveTicker from "@/components/LiveTicker";
import ModulesShowcase from "@/pages/landing/ModulesShowcase";
import ModuleTourCTA from "@/pages/landing/ModuleTourCTA"; // v43.99.20
import ActivityHeatmap from "@/components/ActivityHeatmap";
import CostSavingsWidget from "@/components/CostSavingsWidget";
import AchievementBadges from "@/components/AchievementBadges";
import HeroLivePreview from "@/components/HeroLivePreview";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useI18n, useT } from "@/i18n";

const LANG_STRINGS = {
  en: {
    hero_badge: "Commercial mail security for WHM / cPanel",
    hero_title_a: "Keep spam and threats",
    hero_title_b: "out of your servers.",
    hero_sub: "GökyüzüWebSpam unifies SpamAssassin, ClamAV, DCC, Vipul's Razor and an LLM-based AI classifier in one interface. Installs on WHM in 60 seconds. Manage quarantine, whitelist/blacklist and outbound mail from a single panel.",
    cta_primary: "Buy Now",
    cta_secondary: "Live Demo",
    trusted: "IP-based licensing · 7-day free demo · WHM AppConfig integration",
    features_title: "Why GökyüzüWebSpam?",
    features_sub: "Everything competitor plugins (ConfigServer MailScanner, MagicSpam, MailScanner Pro) offer — plus a modern UI, AI, and i18n.",
    f1_t: "5 Engines · One UI",
    f1_d: "SpamAssassin + Rspamd + ClamAV + DCC + Razor. Switch active engine in one click; daemon auto-restarts.",
    f2_t: "AI Rule Generator",
    f2_d: "Describe the spam pattern — Claude/GPT/Gemini generates regex rules you can add with one click.",
    f3_t: "6 Languages",
    f3_d: "TR/EN/DE/FR/ES/AR. Auto-detects cPanel language; UX is localized end-to-end.",
    f4_t: "IP-based Licensing",
    f4_d: "Perl heartbeat daemon polls the license server every 5 min. Admins get alerts on unauthorized IPs.",
    f5_t: "Quarantine + Bayes",
    f5_d: "Bulk-mark 'not spam' — Bayes learns instantly, whitelist updates automatically.",
    f6_t: "Outbound Control",
    f6_d: "Hourly per-user limit + auto-cutoff on rule violation + admin notification.",
    stats_title: "By The Numbers",
    stats_1: "spam block rate",
    stats_2: "minutes to install",
    stats_3: "emails / hour throughput",
    stats_4: "languages",
    how_title: "Live in 3 Steps",
    how1_t: "1. Buy",
    how1_d: "Secure Stripe payment. Test/Live auto-detected. Key delivered via email.",
    how2_t: "2. One-line Install",
    how2_d: "SSH into your WHM as root, run our wget one-liner. Takes 60 seconds.",
    how3_t: "3. Activate",
    how3_d: "WHM > Plugins > GökyüzüWebSpam. Paste key, pick engines, quarantine kicks in.",
    pricing_title: "Transparent Pricing",
    pricing_sub: "Per server, free IP changes. Cancel anytime.",
    plans_loading: "Loading plans…",
    per_month: "/month",
    per_year: "/year",
    yearly_save: "2 months free",
    pick_plan: "Get This Plan",
    faq_title: "FAQ",
    faq1_q: "Is my cPanel/WHM version compatible?",
    faq1_a: "Fully compatible with WHM/cPanel 110+. Runs on CentOS 7+, AlmaLinux 8+, Rocky 8+.",
    faq2_q: "Will it break my current spam setup?",
    faq2_a: "No. It attaches to Exim as a milter beside SpamAssassin. Disable any time.",
    faq3_q: "What if my IP changes?",
    faq3_a: "Just hit 'Verify License' in the panel — new IP is registered. No extra fee.",
    faq4_q: "Do I need a separate API key for the AI rule generator?",
    faq4_a: "No. Emergent LLM key ships with the plugin; Claude/GPT/Gemini all supported.",
    footer_prod: "Product",
    footer_dev: "Developers",
    footer_company: "Company",
    footer_features: "Features",
    footer_pricing: "Pricing",
    footer_demo: "Live Demo",
    footer_docs: "Docs",
    footer_install: "Install",
    footer_api: "API",
    footer_about: "About",
    footer_contact: "Contact",
    footer_copyright: "© 2026 GökyüzüWebSpam. All rights reserved.",
    demo_badge: "🎬 Live Demo",
    demo_hint: "No auth — browse the panel freely",
    nav_features: "Features",
    nav_module_tour: "Module Tour",
    nav_how: "How it works",
    nav_pricing: "Pricing",
    nav_faq: "FAQ",
    nav_reseller: "Reseller Portal",
    nav_panel: "Panel",
    nav_buy: "Buy",
  },
  de: {
    hero_badge: "Kommerzielle Mail-Sicherheit für WHM / cPanel",
    hero_title_a: "Halten Sie Spam und Bedrohungen",
    hero_title_b: "aus Ihren Servern fern.",
    hero_sub: "GökyüzüWebSpam vereint SpamAssassin, ClamAV, DCC, Vipul's Razor und einen LLM-basierten KI-Klassifikator in einer Oberfläche. Installation auf WHM in 60 Sekunden. Quarantäne, Whitelist/Blacklist und ausgehende Mails in einem Panel.",
    cta_primary: "Jetzt kaufen",
    cta_secondary: "Live-Demo",
    trusted: "IP-basierte Lizenzierung · 7 Tage kostenlose Demo · WHM AppConfig-Integration",
    features_title: "Warum GökyüzüWebSpam?",
    features_sub: "Alles, was Konkurrenz-Plugins (ConfigServer MailScanner, MagicSpam, MailScanner Pro) bieten — plus moderne Oberfläche, KI und i18n.",
    f1_t: "5 Engines · Eine Oberfläche",
    f1_d: "SpamAssassin + Rspamd + ClamAV + DCC + Razor. Aktive Engine per Klick wechseln; Daemon startet automatisch neu.",
    f2_t: "KI-Regelgenerator",
    f2_d: "Beschreiben Sie das Spam-Muster — Claude/GPT/Gemini generiert Regex-Regeln zum Ein-Klick-Import.",
    f3_t: "6 Sprachen",
    f3_d: "TR/EN/DE/FR/ES/AR. Erkennt cPanel-Sprache automatisch; UX ist durchgehend lokalisiert.",
    f4_t: "IP-basierte Lizenzierung",
    f4_d: "Perl-Heartbeat-Daemon pollt Lizenzserver alle 5 Min. Admins erhalten Alarme bei nicht autorisierten IPs.",
    f5_t: "Quarantäne + Bayes",
    f5_d: "Bulk-Markierung „kein Spam” — Bayes lernt sofort, Whitelist wird automatisch aktualisiert.",
    f6_t: "Ausgehende Kontrolle",
    f6_d: "Stundenlimit pro Benutzer + automatische Abschaltung bei Regelverletzung + Admin-Benachrichtigung.",
    stats_title: "In Zahlen",
    stats_1: "Spam-Blockierungsrate",
    stats_2: "Minuten zur Installation",
    stats_3: "E-Mails / Stunde Durchsatz",
    stats_4: "Sprachen",
    how_title: "Live in 3 Schritten",
    how1_t: "1. Kaufen",
    how1_d: "Sichere Stripe-Zahlung. Test/Live automatisch erkannt. Schlüssel per E-Mail.",
    how2_t: "2. Ein-Zeilen-Installation",
    how2_d: "Per SSH als Root auf Ihren WHM, wget-Einzeiler ausführen. 60 Sekunden.",
    how3_t: "3. Aktivieren",
    how3_d: "WHM > Plugins > GökyüzüWebSpam. Schlüssel einfügen, Engines wählen, Quarantäne läuft.",
    pricing_title: "Transparente Preise",
    pricing_sub: "Pro Server, kostenlose IP-Änderungen. Jederzeit kündbar.",
    plans_loading: "Pläne werden geladen…",
    per_month: "/Monat",
    per_year: "/Jahr",
    yearly_save: "2 Monate gratis",
    pick_plan: "Diesen Plan wählen",
    faq_title: "FAQ",
    faq1_q: "Ist meine cPanel/WHM-Version kompatibel?",
    faq1_a: "Voll kompatibel mit WHM/cPanel 110+. Läuft auf CentOS 7+, AlmaLinux 8+, Rocky 8+.",
    faq2_q: "Wird mein aktuelles Spam-Setup gestört?",
    faq2_a: "Nein. Es hängt sich als Milter neben SpamAssassin in Exim ein. Jederzeit deaktivierbar.",
    faq3_q: "Was passiert, wenn sich meine IP ändert?",
    faq3_a: "Klicken Sie im Panel auf ‚Lizenz prüfen' — neue IP wird registriert. Keine Zusatzkosten.",
    faq4_q: "Brauche ich einen separaten API-Schlüssel für den KI-Regelgenerator?",
    faq4_a: "Nein. Emergent-LLM-Schlüssel wird mit dem Plugin geliefert; Claude/GPT/Gemini alle unterstützt.",
    footer_prod: "Produkt", footer_dev: "Entwickler", footer_company: "Firma",
    footer_features: "Funktionen", footer_pricing: "Preise", footer_demo: "Live-Demo",
    footer_docs: "Dokumentation", footer_install: "Installation", footer_api: "API",
    footer_about: "Über uns", footer_contact: "Kontakt",
    footer_copyright: "© 2026 GökyüzüWebSpam. Alle Rechte vorbehalten.",
    demo_badge: "🎬 Live-Demo", demo_hint: "Keine Anmeldung — frei durchsuchen",
    nav_features: "Funktionen", nav_module_tour: "Modul-Tour", nav_how: "Anleitung",
    nav_pricing: "Preise", nav_faq: "FAQ", nav_reseller: "Reseller-Portal",
    nav_panel: "Zum Panel", nav_buy: "Kaufen",
  },
  fr: {
    hero_badge: "Sécurité e-mail commerciale pour WHM / cPanel",
    hero_title_a: "Empêchez le spam et les menaces",
    hero_title_b: "d'atteindre vos serveurs.",
    hero_sub: "GökyüzüWebSpam unifie SpamAssassin, ClamAV, DCC, Vipul's Razor et un classificateur IA basé LLM en une seule interface. Installation sur WHM en 60 secondes. Gérez quarantaine, liste blanche/noire et courrier sortant depuis un panneau unique.",
    cta_primary: "Acheter",
    cta_secondary: "Démo en direct",
    trusted: "Licence par IP · Démo gratuite 7 jours · Intégration WHM AppConfig",
    features_title: "Pourquoi GökyüzüWebSpam ?",
    features_sub: "Tout ce que les plugins concurrents (ConfigServer MailScanner, MagicSpam, MailScanner Pro) offrent — plus une interface moderne, l'IA et l'i18n.",
    f1_t: "5 moteurs · Une UI",
    f1_d: "SpamAssassin + Rspamd + ClamAV + DCC + Razor. Basculez le moteur en un clic ; le démon redémarre automatiquement.",
    f2_t: "Générateur de règles IA",
    f2_d: "Décrivez le motif de spam — Claude/GPT/Gemini génère des règles regex à ajouter en un clic.",
    f3_t: "6 langues",
    f3_d: "TR/EN/DE/FR/ES/AR. Détecte la langue cPanel automatiquement ; UX localisée de bout en bout.",
    f4_t: "Licence par IP",
    f4_d: "Le démon heartbeat Perl interroge le serveur de licence toutes les 5 min. Les admins reçoivent des alertes sur les IP non autorisées.",
    f5_t: "Quarantaine + Bayes",
    f5_d: "Marquez en masse « pas spam » — Bayes apprend instantanément, la liste blanche se met à jour.",
    f6_t: "Contrôle sortant",
    f6_d: "Limite horaire par utilisateur + coupure auto sur violation + notification admin.",
    stats_title: "En chiffres",
    stats_1: "taux de blocage spam",
    stats_2: "minutes pour installer",
    stats_3: "e-mails / heure de débit",
    stats_4: "langues",
    how_title: "En direct en 3 étapes",
    how1_t: "1. Acheter",
    how1_d: "Paiement Stripe sécurisé. Test/Live auto-détecté. Clé livrée par e-mail.",
    how2_t: "2. Installation en une ligne",
    how2_d: "SSH dans votre WHM en root, lancez notre one-liner wget. 60 secondes.",
    how3_t: "3. Activer",
    how3_d: "WHM > Plugins > GökyüzüWebSpam. Collez la clé, choisissez les moteurs, la quarantaine s'active.",
    pricing_title: "Tarifs transparents",
    pricing_sub: "Par serveur, changements IP gratuits. Annulation à tout moment.",
    plans_loading: "Chargement des plans…",
    per_month: "/mois", per_year: "/an",
    yearly_save: "2 mois offerts",
    pick_plan: "Choisir ce plan",
    faq_title: "FAQ",
    faq1_q: "Ma version cPanel/WHM est-elle compatible ?",
    faq1_a: "Entièrement compatible avec WHM/cPanel 110+. Fonctionne sur CentOS 7+, AlmaLinux 8+, Rocky 8+.",
    faq2_q: "Cela cassera-t-il ma configuration spam actuelle ?",
    faq2_a: "Non. Il s'attache à Exim comme milter à côté de SpamAssassin. Désactivable à tout moment.",
    faq3_q: "Que se passe-t-il si mon IP change ?",
    faq3_a: "Cliquez sur « Vérifier la licence » dans le panneau — la nouvelle IP est enregistrée. Aucun frais.",
    faq4_q: "Ai-je besoin d'une clé API séparée pour le générateur IA ?",
    faq4_a: "Non. La clé Emergent LLM est incluse ; Claude/GPT/Gemini tous supportés.",
    footer_prod: "Produit", footer_dev: "Développeurs", footer_company: "Société",
    footer_features: "Fonctionnalités", footer_pricing: "Tarifs", footer_demo: "Démo",
    footer_docs: "Docs", footer_install: "Installation", footer_api: "API",
    footer_about: "À propos", footer_contact: "Contact",
    footer_copyright: "© 2026 GökyüzüWebSpam. Tous droits réservés.",
    demo_badge: "🎬 Démo en direct", demo_hint: "Sans authentification — navigation libre",
    nav_features: "Fonctionnalités", nav_module_tour: "Tour des Modules", nav_how: "Comment ça marche",
    nav_pricing: "Tarifs", nav_faq: "FAQ", nav_reseller: "Portail Revendeur",
    nav_panel: "Panneau", nav_buy: "Acheter",
  },
  es: {
    hero_badge: "Seguridad de correo comercial para WHM / cPanel",
    hero_title_a: "Mantén el spam y las amenazas",
    hero_title_b: "fuera de tus servidores.",
    hero_sub: "GökyüzüWebSpam unifica SpamAssassin, ClamAV, DCC, Vipul's Razor y un clasificador IA basado en LLM en una sola interfaz. Instalación en WHM en 60 segundos. Gestiona cuarentena, lista blanca/negra y correo saliente desde un único panel.",
    cta_primary: "Comprar ya",
    cta_secondary: "Demo en vivo",
    trusted: "Licencia por IP · Demo gratis 7 días · Integración WHM AppConfig",
    features_title: "¿Por qué GökyüzüWebSpam?",
    features_sub: "Todo lo que ofrecen los plugins competidores (ConfigServer MailScanner, MagicSpam, MailScanner Pro) — más una interfaz moderna, IA e i18n.",
    f1_t: "5 motores · Una UI",
    f1_d: "SpamAssassin + Rspamd + ClamAV + DCC + Razor. Cambia el motor activo con un clic; el demonio se reinicia.",
    f2_t: "Generador de reglas IA",
    f2_d: "Describe el patrón de spam — Claude/GPT/Gemini genera reglas regex para añadir con un clic.",
    f3_t: "6 idiomas",
    f3_d: "TR/EN/DE/FR/ES/AR. Detecta el idioma cPanel automáticamente; UX localizada de extremo a extremo.",
    f4_t: "Licencia por IP",
    f4_d: "El demonio heartbeat Perl consulta el servidor de licencias cada 5 min. Los admins reciben alertas por IPs no autorizadas.",
    f5_t: "Cuarentena + Bayes",
    f5_d: "Marca en lote « no es spam » — Bayes aprende al instante, la lista blanca se actualiza.",
    f6_t: "Control saliente",
    f6_d: "Límite por hora por usuario + corte automático en violación + notificación admin.",
    stats_title: "En números",
    stats_1: "tasa de bloqueo de spam",
    stats_2: "minutos para instalar",
    stats_3: "correos / hora de rendimiento",
    stats_4: "idiomas",
    how_title: "En vivo en 3 pasos",
    how1_t: "1. Comprar",
    how1_d: "Pago Stripe seguro. Test/Live auto-detectado. Clave enviada por e-mail.",
    how2_t: "2. Instalación en una línea",
    how2_d: "SSH en tu WHM como root, ejecuta nuestro wget one-liner. 60 segundos.",
    how3_t: "3. Activar",
    how3_d: "WHM > Plugins > GökyüzüWebSpam. Pega la clave, elige motores, la cuarentena se activa.",
    pricing_title: "Precios transparentes",
    pricing_sub: "Por servidor, cambios de IP gratis. Cancela cuando quieras.",
    plans_loading: "Cargando planes…",
    per_month: "/mes", per_year: "/año",
    yearly_save: "2 meses gratis",
    pick_plan: "Elegir este plan",
    faq_title: "FAQ",
    faq1_q: "¿Mi versión cPanel/WHM es compatible?",
    faq1_a: "Totalmente compatible con WHM/cPanel 110+. Funciona en CentOS 7+, AlmaLinux 8+, Rocky 8+.",
    faq2_q: "¿Romperá mi configuración de spam actual?",
    faq2_a: "No. Se conecta a Exim como milter junto a SpamAssassin. Deshabilita cuando quieras.",
    faq3_q: "¿Qué pasa si mi IP cambia?",
    faq3_a: "Pulsa « Verificar licencia » en el panel — la nueva IP se registra. Sin coste extra.",
    faq4_q: "¿Necesito una clave API separada para el generador IA?",
    faq4_a: "No. La clave Emergent LLM viene con el plugin; Claude/GPT/Gemini soportados.",
    footer_prod: "Producto", footer_dev: "Desarrolladores", footer_company: "Empresa",
    footer_features: "Funciones", footer_pricing: "Precios", footer_demo: "Demo",
    footer_docs: "Docs", footer_install: "Instalación", footer_api: "API",
    footer_about: "Nosotros", footer_contact: "Contacto",
    footer_copyright: "© 2026 GökyüzüWebSpam. Todos los derechos reservados.",
    demo_badge: "🎬 Demo en vivo", demo_hint: "Sin autenticación — navega libremente",
    nav_features: "Funciones", nav_module_tour: "Tour de Módulos", nav_how: "Cómo funciona",
    nav_pricing: "Precios", nav_faq: "FAQ", nav_reseller: "Portal Revendedor",
    nav_panel: "Panel", nav_buy: "Comprar",
  },
  ar: {
    hero_badge: "أمان بريد تجاري لـ WHM / cPanel",
    hero_title_a: "أبقِ البريد المزعج والتهديدات",
    hero_title_b: "بعيدة عن خوادمك.",
    hero_sub: "يوحّد GökyüzüWebSpam بين SpamAssassin و ClamAV و DCC و Vipul's Razor ومصنّف ذكاء اصطناعي بنموذج LLM في واجهة واحدة. يُثبَّت على WHM خلال 60 ثانية. أدر الحجر والقوائم البيضاء/السوداء والبريد الصادر من لوحة واحدة.",
    cta_primary: "اشترِ الآن",
    cta_secondary: "عرض مباشر",
    trusted: "ترخيص بحسب IP · تجربة مجانية 7 أيام · تكامل WHM AppConfig",
    features_title: "لماذا GökyüzüWebSpam؟",
    features_sub: "كل ما تقدمه الإضافات المنافسة (ConfigServer MailScanner و MagicSpam و MailScanner Pro) — بالإضافة إلى واجهة عصرية وذكاء اصطناعي وتعدد لغات.",
    f1_t: "5 محركات · واجهة واحدة",
    f1_d: "SpamAssassin + Rspamd + ClamAV + DCC + Razor. بدّل المحرك النشط بنقرة؛ يعاد تشغيل الخدمة تلقائيًا.",
    f2_t: "مولّد قواعد بالذكاء الاصطناعي",
    f2_d: "صف نمط البريد المزعج — Claude/GPT/Gemini يولّد قواعد regex لإضافتها بنقرة.",
    f3_t: "6 لغات",
    f3_d: "TR/EN/DE/FR/ES/AR. يكتشف لغة cPanel تلقائيًا؛ الواجهة موطّنة بالكامل.",
    f4_t: "ترخيص بحسب IP",
    f4_d: "خادم Perl heartbeat يستعلم من خادم التراخيص كل 5 دقائق. المدير يتلقى تنبيهات عند IP غير مصرح.",
    f5_t: "الحجر + Bayes",
    f5_d: "علّم دفعيًا « ليس مزعجًا » — Bayes يتعلم فورًا، تحدَّث القائمة البيضاء تلقائيًا.",
    f6_t: "التحكم بالصادر",
    f6_d: "حد ساعي لكل مستخدم + قطع تلقائي عند مخالفة قاعدة + إبلاغ المدير.",
    stats_title: "بالأرقام",
    stats_1: "معدل حجب البريد المزعج",
    stats_2: "دقائق للتثبيت",
    stats_3: "بريد / ساعة معدّل معالجة",
    stats_4: "لغات",
    how_title: "نشط في 3 خطوات",
    how1_t: "1. اشترِ",
    how1_d: "دفع آمن عبر Stripe. اختبار/إنتاج تلقائي. المفتاح يصلك بالبريد.",
    how2_t: "2. تثبيت بأمر واحد",
    how2_d: "اتصل SSH بخادمك WHM كـ root، وشغّل أمر wget. 60 ثانية.",
    how3_t: "3. فعّل",
    how3_d: "WHM > Plugins > GökyüzüWebSpam. ألصق المفتاح، اختر المحركات، يبدأ الحجر.",
    pricing_title: "تسعير شفاف",
    pricing_sub: "لكل خادم، تغييرات IP مجانية. إلغاء في أي وقت.",
    plans_loading: "جار تحميل الخطط…",
    per_month: "/شهر", per_year: "/سنة",
    yearly_save: "شهران مجانيان",
    pick_plan: "اختر هذه الخطة",
    faq_title: "الأسئلة الشائعة",
    faq1_q: "هل إصدار cPanel/WHM متوافق؟",
    faq1_a: "متوافق تمامًا مع WHM/cPanel 110+. يعمل على CentOS 7+ و AlmaLinux 8+ و Rocky 8+.",
    faq2_q: "هل سيؤثر على إعدادات البريد الحالية؟",
    faq2_a: "لا. يعمل كـ milter مع Exim إلى جانب SpamAssassin. عطّله وقتما تشاء.",
    faq3_q: "ماذا لو تغيّر IP الخادم؟",
    faq3_a: "اضغط « تحقق من الترخيص » في اللوحة — يُسجَّل IP الجديد. بلا رسوم إضافية.",
    faq4_q: "هل أحتاج مفتاح API منفصل لمولّد قواعد الذكاء الاصطناعي؟",
    faq4_a: "لا. مفتاح Emergent LLM يأتي مع الإضافة؛ Claude/GPT/Gemini كلها مدعومة.",
    footer_prod: "المنتج", footer_dev: "المطورون", footer_company: "الشركة",
    footer_features: "المزايا", footer_pricing: "الأسعار", footer_demo: "عرض مباشر",
    footer_docs: "التوثيق", footer_install: "التثبيت", footer_api: "API",
    footer_about: "من نحن", footer_contact: "اتصال",
    footer_copyright: "© 2026 GökyüzüWebSpam. جميع الحقوق محفوظة.",
    demo_badge: "🎬 عرض مباشر", demo_hint: "بلا مصادقة — تصفّح بحرية",
    nav_features: "الميزات", nav_module_tour: "جولة الوحدات", nav_how: "كيف يعمل",
    nav_pricing: "الأسعار", nav_faq: "الأسئلة الشائعة", nav_reseller: "بوابة الموزع",
    nav_panel: "لوحة التحكم", nav_buy: "شراء",
  },
  tr: {
    hero_badge: "WHM / cPanel için ticari mail güvenliği",
    hero_title_a: "Sunucunuzdan",
    hero_title_b: "spam ve tehdit sızmasın.",
    hero_sub: "GökyüzüWebSpam; SpamAssassin, ClamAV, DCC, Vipul's Razor ve LLM tabanlı AI sınıflandırıcıyı tek arayüzde birleştirir. WHM'e 60 saniyede kurulur, karantina/whitelist/blacklist ve giden posta kontrolünü teker teker yönetir.",
    cta_primary: "Şimdi Satın Al",
    cta_secondary: "Canlı Demo",
    trusted: "IP-bazlı lisans · 7 gün ücretsiz demo · WHM AppConfig entegrasyonu",
    features_title: "Neden GökyüzüWebSpam?",
    features_sub: "Rakip pluginlerin (ConfigServer MailScanner, MagicSpam, MailScanner Pro) sunduğu her şey — üstüne modern UI, AI ve i18n.",
    f1_t: "5 Motor · Tek Arayüz",
    f1_d: "SpamAssassin + Rspamd + ClamAV + DCC + Razor. Aktif motoru tek tıkla değiştir, daemon otomatik yeniden başlar.",
    f2_t: "AI Kural Üretici",
    f2_d: "Yakalamak istediğiniz spam türünü Türkçe anlatın — Claude/GPT/Gemini regex kuralları üretir, tek tıkla ekleyin.",
    f3_t: "6 Dil Desteği",
    f3_d: "TR/EN/DE/FR/ES/AR. cPanel dilini otomatik algılar, kullanıcı deneyimini yerelleştirir.",
    f4_t: "IP-Bazlı Lisans",
    f4_d: "Perl heartbeat daemon her 5 dakikada license server'ı yoklar. İzinsiz IP'den ihlalde admin alarm alır.",
    f5_t: "Karantina + Bayes",
    f5_d: "Otomatik izole edilen mesajları toplu 'spam değil' işaretleyin — Bayes anında öğrenir, whitelist güncellenir.",
    f6_t: "Giden Posta Kontrolü",
    f6_d: "cPanel hesabı başına saatlik limit + kural ihlalinde otomatik kesim + admin bildirimi.",
    stats_title: "Sayılarla",
    stats_1: "spam engelleme oranı",
    stats_2: "dakika içinde kurulum",
    stats_3: "e-posta / saat işleme kapasitesi",
    stats_4: "dil desteği",
    how_title: "3 Adımda Aktif",
    how1_t: "1. Satın Al",
    how1_d: "Stripe üzerinden güvenli ödeme. Test/Live otomatik. Anahtar e-postanıza gelir.",
    how2_t: "2. Tek Komut Kur",
    how2_d: "WHM sunucunuza root SSH ile bağlanıp wget one-liner'ı çalıştırın. 60 saniye.",
    how3_t: "3. Aktif Et",
    how3_d: "WHM > Plugins > GökyüzüWebSpam. Lisansı gir, motorları seç, karantina çalışmaya başlar.",
    pricing_title: "Şeffaf Fiyatlandırma",
    pricing_sub: "Sunucu başına, IP değişikliği ücretsiz. İptal esnektir.",
    plans_loading: "Planlar yükleniyor…",
    per_month: "/ay",
    per_year: "/yıl",
    yearly_save: "iki ay bedava",
    pick_plan: "Bu Planı Al",
    faq_title: "Sıkça Sorulanlar",
    faq1_q: "cPanel/WHM sürümüm uyumlu mu?",
    faq1_a: "WHM/cPanel 110+ ile tam uyumlu. CentOS 7+, AlmaLinux 8+, Rocky 8+ üzerinde çalışır.",
    faq2_q: "Mevcut spam ayarlarımı bozar mı?",
    faq2_a: "Hayır. GökyüzüWebSpam SpamAssassin + Exim milter olarak yanına takılır. İstediğiniz zaman devre dışı bırakabilirsiniz.",
    faq3_q: "IP değişirse ne olur?",
    faq3_a: "Panelden 'Lisansı Sorgula' ile yeni IP'yi kaydedin. Ekstra ücret yok.",
    faq4_q: "AI kural üretici için ekstra bir API anahtarı lazım mı?",
    faq4_a: "Hayır. Emergent LLM anahtarı plugin ile birlikte gelir; Claude/GPT/Gemini üçünü de destekler.",
    footer_prod: "Ürün",
    footer_dev: "Geliştiriciler",
    footer_company: "Şirket",
    footer_features: "Özellikler",
    footer_pricing: "Fiyatlandırma",
    footer_demo: "Canlı Demo",
    footer_docs: "Dokümantasyon",
    footer_install: "Kurulum",
    footer_api: "API",
    footer_about: "Hakkımızda",
    footer_contact: "İletişim",
    footer_copyright: "© 2026 GökyüzüWebSpam. Tüm hakları saklıdır.",
    demo_badge: "🎬 Canlı Demo",
    demo_hint: "Kimlik doğrulama yok — panelde dilediğince gezinin",
    nav_features: "Özellikler",
    nav_module_tour: "Modül Turu",
    nav_how: "Nasıl Çalışır",
    nav_pricing: "Fiyatlandırma",
    nav_faq: "SSS",
    nav_reseller: "Bayi Portalı",
    nav_panel: "Panele Dön",
    nav_buy: "Satın Al",
  },
};

function useLandingStrings() {
  const { effective } = useI18n();
  const base = LANG_STRINGS[effective] || LANG_STRINGS.en;
  const cms = useLandingCms();
  const variant = useAbVariant(cms);
  // v43.11 Multi-lang: content_by_lang varsa aktif dile göre override çek.
  // v43.12 A/B: seçilen variant B ise hero override'ını variant_b_hero_by_lang'dan al.
  const langBlock = (cms?.content_by_lang && cms.content_by_lang[effective]) || null;
  const heroA = (langBlock?.hero) || (effective === "tr" ? cms?.hero : null) || {};
  const heroB = variant === "B"
    ? ((cms?.variant_b_hero_by_lang && cms.variant_b_hero_by_lang[effective]) || {})
    : {};
  // Variant B alanı doluysa üstüne yazar, boşsa Variant A kullanılır (partial override)
  const hero = variant === "B"
    ? {
        badge:        heroB.badge        || heroA.badge,
        title_a:      heroB.title_a      || heroA.title_a,
        title_b:      heroB.title_b      || heroA.title_b,
        subtitle:     heroB.subtitle     || heroA.subtitle,
        cta_primary:  heroB.cta_primary  || heroA.cta_primary,
        cta_secondary:heroB.cta_secondary|| heroA.cta_secondary,
      }
    : heroA;
  const pick = (k) => {
    if (langBlock && langBlock[k]) return langBlock[k];
    if (effective === "tr" && cms && cms[k]) return cms[k];
    return base[k];
  };
  return {
    ...base,
    hero_badge:    hero.badge     || base.hero_badge,
    hero_title_a:  hero.title_a   || base.hero_title_a,
    hero_title_b:  hero.title_b   || base.hero_title_b,
    hero_sub:      hero.subtitle  || base.hero_sub,
    cta_primary:   hero.cta_primary   || base.cta_primary,
    cta_secondary: hero.cta_secondary || base.cta_secondary,
    features_title:   pick("features_title"),
    features_sub:     pick("features_sub"),
    pricing_title:    pick("pricing_title"),
    pricing_sub:      pick("pricing_sub"),
    footer_copyright: pick("footer_copyright"),
    // Meta — debug için exposed
    _ab_variant: variant,
  };
}

/**
 * v43.12 A/B variant seçici + v43.13 geo scope.
 * - `ab_geo_scope`:
 *   * "global": herkes A/B randomize
 *   * "TR_only": sadece Türkiye ziyaretçileri B'yi görebilir (dışarısı hep A)
 *   * "TR_exclude": Türkiye ziyaretçileri hep A, dışarısı A/B randomize
 * - Ziyaretçi ülkesi ipapi.co/country üzerinden ~ilk 200ms içinde tespit edilir,
 *   sonuç localStorage'a yazılır (bir kez, sonrası cache'lidir).
 */
function useAbVariant(cms) {
  if (!cms?.ab_test_enabled) return "A";
  const scope = (cms?.ab_geo_scope || "global").toString();
  // Ziyaretçi ülkesi (localStorage cache; ilk ziyarette async doldurulur)
  let visitorCountry = "";
  try { visitorCountry = (localStorage.getItem("gws.visitor_country") || "").toUpperCase(); } catch {}
  // İlk ziyaret ve ülke bilinmiyorsa: async fetch başlat, ama şimdilik conservative
  // fallback → geo scope'a bakıp default davran.
  if (!visitorCountry && scope !== "global") {
    // Async country lookup — sonraki ziyaretlerde uygulanır
    try {
      fetch("https://ipapi.co/country/", { cache: "force-cache" })
        .then(r => r.text())
        .then(cc => {
          if (cc && cc.length === 2) localStorage.setItem("gws.visitor_country", cc.toUpperCase());
        })
        .catch(() => {});
    } catch {}
  }
  // Geo scope kısıtlaması
  const isTR = visitorCountry === "TR";
  let allowedForB = true;
  if (scope === "TR_only" && !isTR) allowedForB = false;
  else if (scope === "TR_exclude" && isTR) allowedForB = false;
  if (!allowedForB) return "A";
  try {
    let v = localStorage.getItem("gws.ab_variant");
    if (v !== "A" && v !== "B") {
      v = Math.random() < 0.5 ? "A" : "B";
      localStorage.setItem("gws.ab_variant", v);
      try { api.abTrackImpression?.({ variant: v }); } catch {}
    }
    return v;
  } catch {
    return "A";
  }
}

/**
 * v43.9 Landing settings hook — fetches theme + CMS text overrides.
 * Cached across the whole page via react-query.
 */
function useLandingCms() {
  const q = useQuery({
    queryKey: ["landing-settings"],
    queryFn: () => api.landingGet(),
    staleTime: 60000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return q.data || null;
}
function useLandingTheme() {
  const cms = useLandingCms();
  return (cms?.theme === "light") ? "light" : "dark";
}

function GridBackdrop() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.15),transparent_45%)]"/>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_50%,rgba(244,63,94,0.10),transparent_40%)]"/>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(217,70,239,0.10),transparent_45%)]"/>
      <div className="absolute inset-0 [background-size:64px_64px] [background-image:linear-gradient(to_right,rgba(30,41,59,0.6)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,41,59,0.6)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_30%,#000_60%,transparent_100%)]"/>
      <div className="absolute top-20 right-10 w-72 h-72 rounded-full bg-indigo-500/10 blur-3xl animate-pulse"/>
      <div className="absolute bottom-20 left-1/3 w-96 h-96 rounded-full bg-fuchsia-500/10 blur-3xl animate-pulse" style={{ animationDelay: "1.5s" }}/>
    </div>
  );
}

function NavBar() {
  const { effective, setLang } = useI18n();
  const s = useLandingStrings();
  const langs = ["tr", "en", "de", "fr", "es", "ar"];
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-md" data-testid="landing-nav">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="relative w-9 h-9 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-slate-100 font-bold tracking-tight text-[17px]">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
            <div className="text-[9px] uppercase tracking-widest text-slate-500 mono">WHM / cPanel · v44.00.00</div>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-slate-400">
          <a href="#features" data-testid="nav-features" className="hover:text-slate-100 transition-colors">{s.nav_features}</a>
          <a href="#module-tour" data-testid="nav-module-tour" className="hover:text-fuchsia-300 transition-colors font-semibold text-fuchsia-400">{s.nav_module_tour} 🎬</a>
          <a href="#how" data-testid="nav-how" className="hover:text-slate-100 transition-colors">{s.nav_how}</a>
          <a href="#pricing" data-testid="nav-pricing" className="hover:text-slate-100 transition-colors">{s.nav_pricing}</a>
          <a href="#faq" data-testid="nav-faq" className="hover:text-slate-100 transition-colors">{s.nav_faq}</a>
        </nav>
        <div className="flex items-center gap-2">
          <select
            data-testid="landing-lang"
            value={effective}
            onChange={(e) => setLang(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-md px-2 py-1 text-xs mono text-slate-300 focus:outline-none focus:border-indigo-500/40"
          >
            {langs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
          <Link to="/reseller" data-testid="landing-reseller-cta" className="hidden lg:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-slate-700 bg-slate-900 text-slate-300 text-sm hover:border-slate-600 transition-colors">
            {s.nav_reseller}
          </Link>
          <Link to="/panel" data-testid="landing-panel-cta" className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 text-sm hover:bg-emerald-500/20 transition-colors">
            <ShieldAlert className="w-3.5 h-3.5"/> {s.nav_panel}
          </Link>
          <Link to="/shop" data-testid="landing-buy-cta" className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-sm font-medium shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-shadow">
            {s.nav_buy} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const s = useLandingStrings();
  const live = useQuery({ queryKey: ["overview-hero"], queryFn: api.overview, refetchInterval: 20000, retry: false });
  const stats = live.data || {};
  const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);
  // v43.16 — Hero live preview toggle (CMS-controlled)
  const cms = useLandingCms();
  const heroPreviewEnabled = cms?.hero_preview_enabled !== false; // default AÇIK
  return (
    <section className="relative pt-20 pb-24 md:pt-28 md:pb-32" data-testid="landing-hero">
      <GridBackdrop />
      <div className="max-w-7xl mx-auto px-6">
        <div className={heroPreviewEnabled
          ? "grid grid-cols-1 lg:grid-cols-12 gap-8 items-center"
          : ""}>
          <div className={heroPreviewEnabled ? "lg:col-span-7" : "max-w-4xl"}>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs mono uppercase tracking-widest mb-6">
            <Sparkles className="w-3 h-3" /> {s.hero_badge}
            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse ml-1"/>
            <span className="text-emerald-300 normal-case">canlı</span>
          </div>
          <div><LiveBlockCounter/></div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-100 mb-6 leading-[1.05]">
            {s.hero_title_a} <span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">{s.hero_title_b}</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mb-8 leading-relaxed">
            {s.hero_sub}
          </p>
          <div className="flex flex-wrap gap-3 mb-8">
            <Link to="/shop" data-testid="hero-cta-buy"
                  onClick={() => {
                    // v43.13 A/B conversion tracking — CTA primary click = kondisyonlu conversion
                    try {
                      const v = localStorage.getItem("gws.ab_variant");
                      if (v === "A" || v === "B") api.abTrackConversion?.({ variant: v, kind: "cta_primary" });
                    } catch {}
                  }}
                  className="group inline-flex items-center gap-2 px-5 py-3 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-medium shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/50 transition-all hover:-translate-y-0.5">
              {s.cta_primary} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform"/>
            </Link>
            <Link to="/panel" data-testid="hero-cta-demo"
                  onClick={() => {
                    try {
                      const v = localStorage.getItem("gws.ab_variant");
                      if (v === "A" || v === "B") api.abTrackConversion?.({ variant: v, kind: "cta_secondary" });
                    } catch {}
                  }}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-slate-700 bg-slate-900/60 text-slate-100 hover:border-slate-600 hover:bg-slate-800/60 transition-all">
              <Rocket className="w-4 h-4" /> {s.cta_secondary}
            </Link>
            <Link to="/install" data-testid="hero-cta-install" className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-200 hover:border-amber-500/60 hover:bg-amber-500/10 transition-all">
              <Terminal className="w-4 h-4" /> Kurulum Kılavuzu
            </Link>
            <Link to="/panel/docs" className="inline-flex items-center gap-2 px-5 py-3 rounded-md text-slate-400 hover:text-slate-100 transition-colors">
              Dokümantasyon <ArrowRight className="w-3 h-3"/>
            </Link>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mono">
            <BadgeCheck className="w-3.5 h-3.5 text-emerald-400" /> {s.trusted}
          </div>
        </div>

        {/* v43.16 — Right column: Animated hero live preview panel */}
        {heroPreviewEnabled && (
          <div className="lg:col-span-5">
            <HeroLivePreview />
          </div>
        )}
        </div>

        {/* Live Panel Preview */}
        <div className="mt-16 rounded-xl border border-slate-800 bg-slate-900/60 shadow-2xl shadow-indigo-900/20 overflow-hidden backdrop-blur">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-slate-800 bg-slate-950/60">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
            <span className="mono text-[10px] text-slate-500 ml-3">whm.example.com / GökyüzüWebSpam · CANLI VERİ</span>
            <span className="ml-auto flex items-center gap-1 text-[10px] mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>LIVE
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
            {[
              { icon: Activity, label: "Taranan (24s)", val: nfmt(stats.scanned_today || 12481), tone: "text-indigo-400" },
              { icon: ShieldCheck, label: "Bloke (24s)", val: nfmt(stats.caught_today || 2147), tone: "text-rose-400" },
              { icon: Radar, label: "Karantina", val: nfmt(stats.quarantine_total || 319), tone: "text-amber-400" },
              { icon: Mail, label: "Teslim (24s)", val: nfmt(stats.ham_today || 10015), tone: "text-emerald-400" },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 hover:border-slate-700 transition-colors">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                  <k.icon className={`w-3 h-3 ${k.tone}`} /> {k.label}
                </div>
                <div className={`text-2xl mono font-bold ${k.tone}`}>{k.val}</div>
              </div>
            ))}
          </div>
          {/* Feature tags */}
          <div className="px-4 pb-4 flex flex-wrap gap-2">
            {["🌐 Canlı Saldırı Haritası", "🧠 AI Self-Training", "📮 Exim Kuyruk", "🌍 113 Ülke Blok", "🔒 SPF/DKIM/DMARC", "📊 SIEM Export"].map((tag) => (
              <span key={tag} className="text-[10px] px-2 py-1 rounded bg-slate-800/60 border border-slate-700/60 text-slate-300">{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: Cpu, key: "f1", tone: "indigo" },
  { icon: Brain, key: "f2", tone: "fuchsia" },
  { icon: Globe2, key: "f3", tone: "emerald" },
  { icon: Lock, key: "f4", tone: "amber" },
  { icon: Radar, key: "f5", tone: "rose" },
  { icon: Zap, key: "f6", tone: "sky" },
];
const TONE_MAP = {
  indigo: "border-indigo-500/30 bg-indigo-500/5 text-indigo-300",
  fuchsia: "border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-300",
  emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/5 text-rose-300",
  sky: "border-sky-500/30 bg-sky-500/5 text-sky-300",
};

function Features() {
  const s = useLandingStrings();
  return (
    <section id="features" className="py-24 border-t border-slate-800/60 relative overflow-hidden" data-testid="landing-features">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 left-10 w-72 h-72 rounded-full bg-indigo-500/6 blur-3xl"/>
        <div className="absolute bottom-10 right-10 w-72 h-72 rounded-full bg-fuchsia-500/6 blur-3xl"/>
      </div>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="max-w-2xl mb-14">
          <div className="text-xs uppercase tracking-widest text-indigo-400 mono mb-2">Neden Biz</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3 tracking-tight">{s.features_title}</h2>
          <p className="text-slate-400 leading-relaxed">{s.features_sub}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => {
            const iconGrad = {
              indigo:  "from-indigo-400 to-blue-500",
              fuchsia: "from-fuchsia-400 to-pink-500",
              emerald: "from-emerald-400 to-teal-500",
              amber:   "from-amber-400 to-orange-500",
              rose:    "from-rose-400 to-red-500",
              sky:     "from-sky-400 to-cyan-500",
            }[f.tone];
            const glow = {
              indigo:  "rgba(99,102,241,0.35)",
              fuchsia: "rgba(217,70,239,0.35)",
              emerald: "rgba(16,185,129,0.35)",
              amber:   "rgba(251,191,36,0.35)",
              rose:    "rgba(244,63,94,0.35)",
              sky:     "rgba(56,189,248,0.35)",
            }[f.tone];
            return (
              <div key={f.key}
                   style={{ "--glow": glow, "--i": i }}
                   className="group relative rounded-2xl border border-slate-800 p-6 overflow-hidden
                              bg-gradient-to-br from-slate-900/70 to-slate-950/50 gws-feature-card
                              shadow-[0_8px_28px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)]
                              hover:-translate-y-1.5 hover:border-slate-700 transition-all duration-300
                              hover:shadow-[0_16px_40px_-10px_var(--glow),inset_0_1px_0_0_rgba(255,255,255,0.08)]">
                {/* Corner glow */}
                <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-30 blur-3xl group-hover:opacity-70 transition-opacity"
                     style={{ background: `radial-gradient(circle, var(--glow), transparent 70%)` }}/>
                {/* 3D Icon */}
                <div className={`relative w-14 h-14 rounded-2xl bg-gradient-to-br ${iconGrad} flex items-center justify-center mb-5
                                shadow-[0_10px_20px_-4px_var(--glow),inset_0_1px_0_0_rgba(255,255,255,0.3)]
                                group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-300`}>
                  <f.icon className="w-6 h-6 text-white drop-shadow-md" strokeWidth={2.25} />
                </div>
                <h3 className="text-lg font-bold text-slate-100 mb-2 tracking-tight">{s[`${f.key}_t`]}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{s[`${f.key}_d`]}</p>
                {/* index badge */}
                <span className="absolute top-4 right-4 text-[10px] mono text-slate-600 tracking-widest gws-feature-idx">0{i + 1}</span>
              </div>
            );
          })}
        </div>
      </div>
      <style>{`
        .gws-landing-light .gws-feature-card {
          background: rgba(255,255,255,0.9) !important;
          border-color: #e2e8f0 !important;
          box-shadow: 0 8px 28px -10px rgba(0,0,0,0.08), inset 0 1px 0 0 rgba(255,255,255,0.95) !important;
        }
        .gws-landing-light .gws-feature-card h3 { color: #0f172a !important; }
        .gws-landing-light .gws-feature-card p  { color: #475569 !important; }
        .gws-landing-light .gws-feature-idx    { color: #cbd5e1 !important; }
      `}</style>
    </section>
  );
}

function Stats() {
  const s = useLandingStrings();
  const items = [
    { val: "99.7%", label: s.stats_1 },
    { val: "60s", label: s.stats_2 },
    { val: "50K+", label: s.stats_3 },
    { val: "6", label: s.stats_4 },
  ];
  return (
    <section className="py-16 border-y border-slate-800/60 bg-slate-950/60">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
        {items.map((it) => (
          <div key={it.label} className="text-center">
            <div className="text-4xl font-bold bg-gradient-to-b from-slate-100 to-slate-400 bg-clip-text text-transparent mono mb-2">{it.val}</div>
            <div className="text-xs uppercase tracking-widest text-slate-500">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const s = useLandingStrings();
  const steps = [
    { icon: Sparkles, t: s.how1_t, d: s.how1_d },
    { icon: Terminal, t: s.how2_t, d: s.how2_d },
    { icon: Rocket, t: s.how3_t, d: s.how3_d },
  ];
  return (
    <section id="how" className="py-24 border-t border-slate-800/60" data-testid="landing-how">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-14 tracking-tight">{s.how_title}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {steps.map((st) => (
            <div key={st.t} className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
              <div className="w-10 h-10 rounded-md bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-4">
                <st.icon className="w-5 h-5 text-indigo-300" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100 mb-2">{st.t}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{st.d}</p>
            </div>
          ))}
        </div>

        {/* Terminal preview */}
        <div className="mt-10 rounded-xl border border-emerald-500/30 bg-slate-950/80 overflow-hidden shadow-lg shadow-emerald-500/5">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 mono">
              <Terminal className="w-3 h-3 text-emerald-400" /> root@whm.yoursrv.com
            </div>
            <Badge tone="success">SSH</Badge>
          </div>
          <pre className="p-5 mono text-[12px] text-slate-300 overflow-x-auto leading-relaxed">
{`# One-line install (60 seconds)
$ wget -O gws.tar.gz "https://gokyuzuhosting.com/api/plugin/download" && \\
  tar -xzf gws.tar.gz && cd gokyuzuwebspam && \\
  chmod +x install.sh && ./install.sh --license=MS-XXXX...

`}<span className="text-emerald-400">{`✔ Registered WHM AppConfig
✔ SpamAssassin milter attached to Exim
✔ ClamAV / DCC / Razor helpers ready
✔ mailshield-api + heartbeat systemd running
→ Open WHM > Plugins > GökyüzüWebSpam`}</span>
          </pre>
        </div>
      </div>
    </section>
  );
}

const PLAN_ORDER = ["starter", "pro", "enterprise"];
const PLAN_HIGHLIGHT = "pro";

function Pricing() {
  const s = useLandingStrings();
  const pricing = useQuery({ queryKey: ["pricing-public"], queryFn: api.pricingPublic });
  const plans = pricing.data?.plans || [];
  const sorted = [...plans].sort((a, b) => PLAN_ORDER.indexOf(a.code) - PLAN_ORDER.indexOf(b.code));

  return (
    <section id="pricing" className="py-24 border-t border-slate-800/60" data-testid="landing-pricing">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3 tracking-tight">{s.pricing_title}</h2>
          <p className="text-slate-400 leading-relaxed">{s.pricing_sub}</p>
        </div>
        {sorted.length === 0 ? (
          <div className="text-center text-slate-500">{s.plans_loading}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {sorted.map((p) => {
              const featured = p.code === PLAN_HIGHLIGHT;
              return (
                <div key={p.code}
                  data-testid={`plan-card-${p.code}`}
                  className={`relative rounded-xl border p-6 flex flex-col ${
                    featured
                      ? "border-indigo-500/60 bg-gradient-to-b from-indigo-500/10 to-slate-900/40 shadow-xl shadow-indigo-500/10"
                      : "border-slate-800 bg-slate-900/40"
                  }`}>
                  {featured && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] uppercase tracking-widest mono border border-indigo-500/60 bg-indigo-500/30 text-indigo-100">
                      Most popular
                    </div>
                  )}
                  <div className="text-lg font-bold text-slate-100 mb-1">{p.name}</div>
                  <div className="text-xs text-slate-500 uppercase tracking-widest mono mb-5">{p.code}</div>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-4xl font-bold text-slate-100 mono">${p.monthly}</span>
                    <span className="text-slate-500 text-sm">{s.per_month}</span>
                  </div>
                  <div className="text-xs text-slate-500 mb-6">
                    ${p.yearly} <span className="text-slate-600">{s.per_year}</span>
                    <span className="ml-1.5 text-emerald-400 mono">({s.yearly_save})</span>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-300 mb-6 flex-1">
                    {(p.features || []).map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to={`/shop?plan=${p.code}`}
                    data-testid={`landing-plan-cta-${p.code}`}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      featured
                        ? "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40"
                        : "border border-slate-700 bg-slate-900/60 text-slate-100 hover:border-slate-600"
                    }`}>
                    {s.pick_plan} <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function FAQ() {
  const s = useLandingStrings();
  const items = [
    { q: s.faq1_q, a: s.faq1_a },
    { q: s.faq2_q, a: s.faq2_a },
    { q: s.faq3_q, a: s.faq3_a },
    { q: s.faq4_q, a: s.faq4_a },
  ];
  return (
    <section id="faq" className="py-24 border-t border-slate-800/60" data-testid="landing-faq">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-10 tracking-tight text-center">{s.faq_title}</h2>
        <div className="space-y-3">
          {items.map((it, i) => (
            <details key={i} className="group rounded-lg border border-slate-800 bg-slate-900/40 p-5 open:border-slate-700 transition-colors">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-slate-100 font-medium">
                {it.q}
                <span className="text-slate-500 group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const items = [
    {
      quote: "3 sunucumuzda kurduk. İlk hafta içinde spam trafiğinin %94'ünü bloke etti. Kullanıcı politikası ve AI kural öneri sistemi işimizi çok kolaylaştırdı.",
      author: "Emre Y.", role: "Sistem Yöneticisi", company: "GökHost", metric: "%94 spam bloke",
    },
    {
      quote: "ConfigServer MailScanner'dan geçtik. Modern arayüz, Türkçe destek ve canlı saldırı haritası müşterilerimiz için de görselleştirilmiş bir güvenlik hissi verdi.",
      author: "Ayşe K.", role: "Kurucu", company: "MavHost Cloud", metric: "12 sunucu",
    },
    {
      quote: "AI Sistem Analizi butonuna bastığımızda 30sn içinde Türkçe rapor + 3 aksiyon önerisi geldi. Kullanıcı deneyimi WHM eklentileri arasında bir seviye üstte.",
      author: "Mustafa D.", role: "DevOps", company: "Netdatatr", metric: "AI-powered",
    },
  ];
  const cases = [
    { logo: "🛒", brand: "E-Ticaret Platformu", size: "450+ cPanel hesabı", result: "%97 azalma", detail: "phishing girişimlerinde" },
    { logo: "🏦", brand: "Fintech Startup", size: "80 sunucu", result: "0 BEC kaybı", detail: "6 ay boyunca" },
    { logo: "🎓", brand: "Üniversite Sistemi", size: "12.000+ öğrenci", result: "%99.8 uptime", detail: "mail teslim oranı" },
  ];
  return (
    <section className="py-24 border-t border-slate-800/60 relative overflow-hidden" data-testid="landing-testimonials">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(217,70,239,0.08),transparent_50%)]"/>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="max-w-2xl mb-14">
          <div className="text-xs uppercase tracking-widest text-fuchsia-400 mono mb-2">Referanslar</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 tracking-tight mb-3">Hosting operatörleri seçti.</h2>
          <p className="text-slate-400 text-lg">Türkiye'de hosting'in içinden yorumlar + gerçek sonuçlar.</p>
        </div>

        {/* Case studies */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {cases.map((c) => (
            <div key={c.brand} data-testid={`case-${c.brand}`} className="group relative rounded-xl border border-slate-800 bg-slate-900/40 p-6 hover:border-indigo-500/40 transition-colors">
              <div className="text-3xl mb-3">{c.logo}</div>
              <div className="text-slate-100 font-semibold">{c.brand}</div>
              <div className="text-xs text-slate-500 mono mb-4">{c.size}</div>
              <div className="pt-4 border-t border-slate-800">
                <div className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">{c.result}</div>
                <div className="text-xs text-slate-500">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {items.map((t, i) => (
            <div key={i} data-testid={`testimonial-${i}`} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 hover:-translate-y-0.5 transition-transform relative">
              <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-white text-lg font-bold shadow-lg">"</div>
              <p className="text-slate-300 text-sm leading-relaxed mb-5">{t.quote}</p>
              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <div>
                  <div className="text-sm text-slate-100 font-medium">{t.author}</div>
                  <div className="text-[11px] text-slate-500">{t.role} · {t.company}</div>
                </div>
                <div className="text-xs text-indigo-300 mono px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/30">{t.metric}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTABottom() {
  const s = useLandingStrings();
  return (
    <section className="py-20 border-t border-slate-800/60 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.15),transparent_60%)]" />
      <div className="max-w-4xl mx-auto px-6 text-center relative">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-4 tracking-tight">
          Ready to <span className="text-indigo-400">block 99.7%</span> of spam?
        </h2>
        <p className="text-slate-400 mb-8">
          Start with a 7-day free demo — no credit card, no surprises.
        </p>
        <div className="flex justify-center gap-3 flex-wrap">
          <Link to="/shop" data-testid="bottom-cta-buy" className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-medium shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-shadow">
            {s.cta_primary} <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/panel" data-testid="bottom-cta-demo" className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-slate-700 bg-slate-900/60 text-slate-100 hover:border-slate-600 transition-colors">
            <Rocket className="w-4 h-4" /> {s.cta_secondary}
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const s = useLandingStrings();
  return (
    <footer className="border-t border-slate-800/60 bg-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            <div className="text-slate-100 font-bold">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
          </div>
          <div className="text-xs text-slate-500 leading-relaxed">
            WHM/cPanel commercial mail security.<br />
            Made with ❤️ for hosting operators.
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-3 font-semibold">{s.footer_prod}</div>
          <ul className="space-y-2 text-sm text-slate-400">
            <li><a href="#features" className="hover:text-slate-100">{s.footer_features}</a></li>
            <li><a href="#pricing" className="hover:text-slate-100">{s.footer_pricing}</a></li>
            <li><Link to="/panel" className="hover:text-slate-100">{s.footer_demo}</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-3 font-semibold">{s.footer_dev}</div>
          <ul className="space-y-2 text-sm text-slate-400">
            <li><Link to="/panel/install" className="hover:text-slate-100">{s.footer_install}</Link></li>
            <li><a href="/api/plugin/install-info" className="hover:text-slate-100">{s.footer_api}</a></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-3 font-semibold">{s.footer_company}</div>
          <ul className="space-y-2 text-sm text-slate-400">
            <li><a href="#faq" className="hover:text-slate-100">FAQ</a></li>
            <li><a href="mailto:destek@gokyuzuhosting.com" className="hover:text-slate-100">{s.footer_contact}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-800/60 py-5 text-center text-xs text-slate-600 mono">
        {s.footer_copyright}
      </div>
    </footer>
  );
}

function SalesTodayBanner() {
  const q = useQuery({
    queryKey: ["landing-sales-today"],
    queryFn: () => api.publicSalesToday(),
    refetchInterval: 45000,   // her 45sn'de yenile (fake ticker)
    staleTime: 30000,
  });
  const d = q.data || {};
  const [tick, setTick] = useState(0);
  // Buyer carousel ilerlet
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 4000);
    return () => clearInterval(id);
  }, []);
  const buyers = d.recent_buyers || [];
  const current = buyers.length > 0 ? buyers[tick % buyers.length] : null;
  const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

  return (
    <div data-testid="landing-sales-today" className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* v43.10 Bugün satın alanlar — 3D glass card */}
      <div className="col-span-1 md:col-span-1 relative overflow-hidden rounded-xl border border-emerald-500/40
                       bg-gradient-to-br from-emerald-500/15 via-emerald-500/8 to-teal-500/10 px-4 py-3
                       shadow-[0_8px_28px_-10px_rgba(16,185,129,0.4),inset_0_1px_0_0_rgba(255,255,255,0.08)] gws-sales-card">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-emerald-500/25 blur-3xl pointer-events-none"/>
        <div className="relative flex items-center gap-2 text-[9px] uppercase tracking-widest text-emerald-300 mono font-bold mb-1.5 gws-sales-label">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-70 animate-ping"/>
            <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500"/>
          </span>
          Bugün Satın Alanlar
        </div>
        <div className="relative flex items-baseline gap-2">
          <span data-testid="sales-today-count" className="text-3xl font-black tabular-nums bg-gradient-to-br from-emerald-200 via-emerald-100 to-teal-200 bg-clip-text text-transparent leading-none gws-sales-count">{nfmt(d.sales_today || 0)}</span>
          <span className="text-[11px] text-emerald-300/80 mono uppercase tracking-widest gws-sales-unit">kişi</span>
        </div>
        <div className="relative text-[10px] text-emerald-300/70 mt-1 gws-sales-hint">
          Bu hafta <span className="text-emerald-200 mono font-bold gws-sales-sub">{nfmt(d.sales_this_week || 0)}</span> · Bu ay <span className="text-emerald-200 mono font-bold gws-sales-sub">{nfmt(d.sales_this_month || 0)}</span>
        </div>
      </div>

      {/* Son satın alan bilgi kartı (rotating) */}
      <div className="col-span-1 md:col-span-2 relative overflow-hidden rounded-xl border border-indigo-500/30
                       bg-gradient-to-br from-slate-900/60 via-indigo-500/5 to-fuchsia-500/5 px-4 py-3 flex items-center gap-3
                       shadow-[0_8px_28px_-10px_rgba(99,102,241,0.35),inset_0_1px_0_0_rgba(255,255,255,0.06)] gws-recent-card">
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-fuchsia-500/15 blur-3xl pointer-events-none"/>
        {current ? (
          <>
            <div className="relative shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 border-2 border-white/20 flex items-center justify-center text-base font-bold text-white shadow-lg shadow-indigo-500/30">
              {current.kind === "firm" ? "🏢" : current.name.charAt(0)}
            </div>
            <div className="relative flex-1 min-w-0" key={tick}>
              <div className="text-[12px] text-slate-300 truncate animate-in fade-in duration-500 gws-recent-name">
                <b className="text-slate-100 gws-recent-strong">{current.name}</b>
                <span className="text-slate-500"> · </span>
                <span className="mr-1">{current.flag || "🌍"}</span>
                <span className="text-slate-400 gws-recent-city">{current.city}</span>
                {current.country_code && (
                  <span className="text-slate-500 mono">, {current.country_code}</span>
                )}
                <span className="text-slate-500"> aldı: </span>
                <span className={`mono font-bold ${current.plan === "Enterprise" ? "text-fuchsia-300" : current.plan === "Pro" ? "text-indigo-300" : "text-emerald-300"}`}>{current.plan}</span>
              </div>
              <div className="text-[10px] text-slate-500 mono mt-1 flex items-center gap-1.5 gws-recent-time">
                <span className="inline-block w-1 h-1 rounded-full bg-emerald-400"/>
                {current.minutes_ago} dakika önce · doğrulandı ✓
              </div>
            </div>
            <div className="relative shrink-0 hidden sm:flex items-center gap-1 text-[9px] text-slate-500">
              {[...Array(6)].map((_, i) => (
                <span key={i} className={`w-1 h-1 rounded-full transition-colors ${(tick % 6) === i ? "bg-indigo-400" : "bg-slate-700"}`}/>
              ))}
            </div>
          </>
        ) : (
          <div className="text-[10px] text-slate-500 mono">Son satın alanlar yükleniyor...</div>
        )}
      </div>
    </div>
  );
}

function LiveBlockCounter() {
  const q = useQuery({
    queryKey: ["landing-blocked-stats"],
    queryFn: () => api.publicBlockedStats("all"),
    refetchInterval: 5000,
    staleTime: 3000,
  });
  const d = q.data || {};
  const target = d.today_blocked || 0;
  const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);
  const [pulse, setPulse] = useState(false);
  const [displayed, setDisplayed] = useState(target);
  useEffect(() => {
    if (target !== displayed) {
      setDisplayed(target);
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 800);
      return () => clearTimeout(t);
    }
  }, [target, displayed]);

  // 7 companion tiles — 3D glass cards with icon glyphs
  const tiles = [
    { icon: Database, label: "Toplam Engellenen", value: d.all_time_blocked, unit: "mail", tone: "orange", hint: "tüm zamanlar" },
    { icon: Bug,      label: "Yakalanan Virüs",   value: d.virus_caught_all_time, unit: "adet", tone: "amber", hint: "ClamAV + AI" },
    { icon: Radar,    label: "Yakalanan Phishing", value: d.phishing_caught_all_time, unit: "adet", tone: "fuchsia", hint: "AI destekli" },
    { icon: ShieldAlert, label: "Yakalanan Exploit", value: d.exploits_caught, unit: "bulgu", tone: "rose", hint: `${d.exploits_critical || 0} kritik` },
    { icon: Lock,     label: "Bloklu IP",         value: d.ips_blocked, unit: "IP", tone: "indigo", hint: "kalıcı liste" },
    { icon: Inbox,    label: "Karantina (Bugün)", value: d.quarantined_today, unit: "mail", tone: "cyan", hint: "gözden geçirir" },
    { icon: Globe,    label: "Tehdit İstihbaratı",value: d.iocs_tracked, unit: "IOC", tone: "purple", hint: "URLhaus + Spamhaus" },
  ];

  // 3D card gradient palette — each tile gets its own hue
  const TONE = {
    orange:  { icon: "from-orange-400 to-amber-500",  glow: "rgba(251,146,60,0.35)", num: "text-orange-200",  numLight: "text-orange-700"  },
    amber:   { icon: "from-amber-400 to-yellow-500",  glow: "rgba(251,191,36,0.35)", num: "text-amber-200",   numLight: "text-amber-700"   },
    fuchsia: { icon: "from-fuchsia-400 to-pink-500",  glow: "rgba(217,70,239,0.35)", num: "text-fuchsia-200", numLight: "text-fuchsia-700" },
    rose:    { icon: "from-rose-400 to-red-500",      glow: "rgba(244,63,94,0.35)",  num: "text-rose-200",    numLight: "text-rose-700"    },
    indigo:  { icon: "from-indigo-400 to-blue-500",   glow: "rgba(99,102,241,0.35)", num: "text-indigo-200",  numLight: "text-indigo-700"  },
    cyan:    { icon: "from-cyan-400 to-sky-500",      glow: "rgba(6,182,212,0.35)",  num: "text-cyan-200",    numLight: "text-cyan-700"    },
    purple:  { icon: "from-purple-400 to-violet-500", glow: "rgba(168,85,247,0.35)", num: "text-purple-200",  numLight: "text-purple-700"  },
  };

  return (
    <div className={`mb-6 transition-transform ${pulse ? "scale-[1.005]" : ""}`}
         data-testid="landing-live-block-counter">
      {/* v43.10 — 3D layered banner with radar sweep + orbital glow */}
      <div className="relative overflow-hidden rounded-2xl mb-3 border border-rose-500/40
                      bg-gradient-to-br from-rose-500/15 via-slate-900/40 to-orange-500/10
                      shadow-[0_10px_40px_-15px_rgba(244,63,94,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)]">
        {/* Radar orbital glow */}
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-rose-500/20 blur-3xl pointer-events-none"/>
        <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-orange-500/15 blur-3xl pointer-events-none"/>
        {/* Grid mesh */}
        <div className="absolute inset-0 opacity-30 pointer-events-none
                        [background-image:linear-gradient(rgba(244,63,94,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(244,63,94,0.15)_1px,transparent_1px)]
                        [background-size:24px_24px]
                        [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_40%,transparent_100%)]"/>

        <div className="relative px-5 py-4 md:px-6 md:py-5 flex items-center gap-4 flex-wrap">
          {/* Radar sweep indicator */}
          <div className="relative w-10 h-10 shrink-0" aria-hidden>
            <span className="absolute inset-0 rounded-full border-2 border-rose-500/50"/>
            <span className="absolute inset-1 rounded-full border border-rose-400/40"/>
            <span className="absolute inset-2 rounded-full bg-rose-500"/>
            <span className="absolute inset-0 rounded-full border-2 border-rose-400 animate-ping opacity-50"/>
          </div>

          {/* Live number — HERO of the banner */}
          <div className="flex-1 min-w-[220px]">
            <div className="text-[10px] uppercase tracking-[0.25em] mono text-rose-300 font-bold mb-0.5 flex items-center gap-2">
              CANLI SİSTEM
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-[9px] text-rose-100 normal-case tracking-normal">
                <span className="w-1 h-1 rounded-full bg-rose-300 animate-pulse"/> gerçek zamanlı
              </span>
            </div>
            <div className="flex items-baseline gap-3 mt-1">
              <span data-testid="landing-live-today"
                    className={`text-4xl md:text-5xl font-black tabular-nums bg-gradient-to-br from-white via-rose-100 to-rose-300 bg-clip-text text-transparent leading-none ${pulse ? "drop-shadow-[0_0_18px_rgba(244,63,94,0.6)]" : ""}`}>
                {nfmt(displayed)}
              </span>
              <span className="text-xs text-rose-200/80 mono uppercase tracking-widest">bugün engellendi</span>
            </div>
            <div className="text-[10px] text-slate-400 mono mt-1">
              {d.block_rate > 0 && <span>• %{d.block_rate} engelleme oranı </span>}
              • 5sn otomatik yenileme • {d.active_licenses || 0} aktif lisans
            </div>
          </div>

          {/* Mini trend indicator */}
          <div className="hidden md:flex items-center gap-3 pl-4 border-l border-slate-700/50">
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-widest text-slate-500 mono">Son 1 saat</div>
              <div className="text-xl font-bold text-emerald-300 mono tabular-nums">
                +{nfmt(d.blocked_last_hour ?? Math.round((displayed || 0) / 24))}
              </div>
            </div>
            <TrendSpark values={d.hourly_last_24 || []}/>
          </div>
        </div>
      </div>

      {/* Sosyal kanıt: bugün satın alanlar */}
      <SalesTodayBanner />

      {/* 3D Metrik grid — floating glass cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mt-3">
        {tiles.map((t, i) => {
          const tone = TONE[t.tone] || TONE.indigo;
          return (
            <div key={i}
                 data-testid={`landing-tile-${i}`}
                 style={{ "--glow": tone.glow }}
                 className="group relative rounded-xl p-3.5 overflow-hidden
                            bg-slate-900/60 border border-slate-800
                            shadow-[0_4px_20px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)]
                            hover:-translate-y-1 hover:border-slate-700
                            hover:shadow-[0_10px_30px_-10px_var(--glow),inset_0_1px_0_0_rgba(255,255,255,0.08)]
                            transition-all duration-300">
              {/* Corner glow */}
              <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-40 blur-2xl group-hover:opacity-70 transition-opacity"
                   style={{ background: `radial-gradient(circle, var(--glow), transparent 70%)` }}/>
              {/* Icon badge (3D) */}
              <div className={`relative w-9 h-9 rounded-lg bg-gradient-to-br ${tone.icon} flex items-center justify-center
                              shadow-[0_4px_12px_-2px_var(--glow),inset_0_1px_0_0_rgba(255,255,255,0.3)]
                              mb-2.5`}>
                <t.icon className="w-4 h-4 text-white drop-shadow-sm" strokeWidth={2.5}/>
              </div>
              <div className="text-[9px] uppercase tracking-widest text-slate-400 mono mb-1 gws-tile-label">{t.label}</div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-black tabular-nums leading-none ${tone.num} gws-tile-num`}>{nfmt(t.value)}</span>
                <span className="text-[10px] text-slate-500 mono gws-tile-unit">{t.unit}</span>
              </div>
              {t.hint && <div className="text-[9px] text-slate-500 mono mt-1 gws-tile-hint">{t.hint}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Modern sparkline for the live banner — pure SVG, dependency-free */
function TrendSpark({ values }) {
  const arr = (values && values.length > 0) ? values : [3, 5, 4, 7, 6, 9, 8, 12, 10, 14, 13, 16];
  const w = 80, h = 32;
  const max = Math.max(...arr, 1);
  const step = w / (arr.length - 1 || 1);
  const pts = arr.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-90">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="#10b981" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon fill="url(#spark-fill)" points={`0,${h} ${pts} ${w},${h}`}/>
      <polyline fill="none" stroke="#10b981" strokeWidth="1.5" points={pts}/>
    </svg>
  );
}

function BlockedTrendWidget() {
  const [region, setRegion] = useState("all");
  const q = useQuery({
    queryKey: ["landing-blocked-stats-trend", region],
    queryFn: () => api.publicBlockedStats(region),
    refetchInterval: 60000,
  });
  const d = q.data || {};
  const series = d.series_30d || [];
  const peak = d.peak_30d || 1;
  const avg = d.avg_30d || 0;
  const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

  const REGIONS = [
    { k: "all", label: "🌍 Tümü", tone: "indigo" },
    { k: "tr", label: "🇹🇷 Türkiye", tone: "rose" },
    { k: "external", label: "🌐 Dış", tone: "amber" },
  ];

  return (
    <section className="py-16 border-t border-slate-800/60 relative overflow-hidden" data-testid="landing-blocked-trend">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(99,102,241,0.06),transparent_60%)]"/>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-indigo-400 mono mb-2 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5"/> Kanıtlanmış Etki
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-100 tracking-tight">
              Son 30 gün: <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-fuchsia-400">{nfmt(series.reduce((a, b) => a + b.count, 0))}</span> spam/virüs engellendi
            </h2>
            <p className="text-slate-400 text-sm mt-2">
              Ortalama: {nfmt(avg)} mail/gün · Zirve: {nfmt(peak)}
              {region !== "all" && <span className="text-slate-500"> · filtre: {REGIONS.find((r) => r.k === region)?.label}</span>}
            </p>
          </div>

          {/* Region filter */}
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {REGIONS.map((r) => (
              <button key={r.k}
                      onClick={() => setRegion(r.k)}
                      data-testid={`region-filter-${r.k}`}
                      className={`text-xs px-3 py-1.5 rounded transition-colors ${
                        region === r.k
                          ? r.tone === "rose" ? "bg-rose-500/20 text-rose-200"
                            : r.tone === "amber" ? "bg-amber-500/20 text-amber-200"
                            : "bg-indigo-500/20 text-indigo-200"
                          : "text-slate-500 hover:text-slate-100"
                      }`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bar chart */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6" data-testid="trend-bar-chart">
          <div className="flex items-end gap-1 h-40">
            {series.map((s, idx) => {
              const h = peak > 0 ? Math.max(3, (s.count / peak) * 100) : 3;
              const isToday = idx === series.length - 1;
              const dayLabel = s.date.slice(5); // MM-DD
              const barColor = region === "tr"
                ? (isToday ? "from-rose-500 to-rose-400" : "from-rose-500/60 to-rose-400/70")
                : region === "external"
                ? (isToday ? "from-amber-500 to-amber-400" : "from-amber-500/60 to-amber-400/70")
                : (isToday ? "from-rose-500 to-rose-400" : "from-indigo-500/60 to-indigo-400/80");
              return (
                <div key={s.date} className="flex-1 h-full flex flex-col items-center gap-1 group relative">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t transition-all bg-gradient-to-t ${barColor} ${
                        isToday ? "shadow-lg" : "group-hover:brightness-125"
                      }`}
                      style={{ height: `${h}%`, minHeight: "4px" }}
                    >
                      <div className="opacity-0 group-hover:opacity-100 -mt-8 text-[10px] mono text-slate-100 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 whitespace-nowrap transition-opacity">
                        {nfmt(s.count)}
                      </div>
                    </div>
                  </div>
                  {idx % 3 === 0 && (
                    <div className="text-[9px] mono text-slate-500">{dayLabel}</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800 text-xs">
            <div className="flex items-center gap-3 text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className={`w-2 h-2 rounded-sm inline-block ${
                  region === "tr" ? "bg-rose-400" : region === "external" ? "bg-amber-400" : "bg-indigo-400"
                }`}/> geçmiş günler
              </span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500 inline-block"/> bugün</span>
            </div>
            <div className="text-slate-500 text-[10px]">otomatik yenileme · 60sn</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LegacyModulesShowcase() {
  const modules = [
    { icon: Filter, name: "MailScanner", desc: "Bağımsız spam/virüs tarayıcı motoru · Bayes filter · özel kural motoru · SIEM entegrasyonu",
      color: "from-indigo-500 to-blue-500", link: "/panel/mailscanner" },
    { icon: Globe, name: "Global Tehdit Zekası", desc: "URLhaus + Spamhaus real feeds · IOC yönetimi · DMARC agregasyon · KVKK/GDPR/HIPAA/SOC2 uyum",
      color: "from-fuchsia-500 to-purple-500", link: "/panel/threat-intel" },
    { icon: HeartPulse, name: "Mail Sağlık Kontrolü", desc: "MX · SPF · DKIM · DMARC · PTR DNS tabanlı toplu kontrol · 100 üzerinden skor",
      color: "from-emerald-500 to-teal-500", link: "/panel/mail-health" },
    { icon: Bug, name: "Exploit / Webshell Tarayıcı", desc: "10 imza · eval/base64/backdoor/RCE tespiti · genişletilebilir bulgular · Perl daemon",
      color: "from-rose-500 to-pink-500", link: "/panel/security" },
    { icon: Radar, name: "14 RBL Reputation", desc: "Spamhaus SBL/CSS/XBL · Barracuda · SORBS · UCEPROTECT · PSBL · DroneBL · PhishTank + delisting akışı",
      color: "from-amber-500 to-orange-500", link: "/panel/blacklist" },
    { icon: Brain, name: "AI Predict Score", desc: "50ms real-time skor · heuristic + Claude/GPT hybrid · otomatik karantina eşiği · self-training",
      color: "from-violet-500 to-indigo-500", link: "/panel/mailscanner" },
    { icon: Globe2, name: "Offline Attack Map", desc: "TopoJSON tabanlı canlı saldırı haritası · IP → ülke lookup · brute-force auto-block",
      color: "from-cyan-500 to-blue-500", link: "/panel/security" },
    { icon: Database, name: "DB Bakım Merkezi", desc: "Depolama raporu · seçici veri temizleme (ayarlar korunur) · toplu maintenance log",
      color: "from-slate-500 to-slate-600", link: "/panel/maintenance" },
  ];
  return (
    <section className="py-24 border-t border-slate-800/60 relative overflow-hidden" data-testid="landing-modules">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(139,92,246,0.08),transparent_60%)]"/>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="max-w-2xl mb-14">
          <div className="text-xs uppercase tracking-widest text-violet-400 mono mb-2">v1.5 · 8 modül</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 tracking-tight mb-3">
            Kurumsal e-posta güvenliği için <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-fuchsia-400">tüm modüller</span> tek panelde.
          </h2>
          <p className="text-slate-400 text-lg">
            Her modül bağımsız çalışır ama birbirini besler. Tehdit zekası MailScanner'ı, MailScanner Exploit'i besler.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.name} to={m.link}
                    data-testid={`landing-module-${m.name}`}
                    className="group relative rounded-xl border border-slate-800 bg-slate-900/40 p-5 hover:border-slate-700 hover:-translate-y-0.5 transition-all overflow-hidden">
                <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${m.color} opacity-10 group-hover:opacity-20 transition-opacity`}/>
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${m.color} flex items-center justify-center mb-3 shadow-lg`}>
                  <Icon className="w-5 h-5 text-white"/>
                </div>
                <div className="text-slate-100 font-semibold text-base mb-1.5">{m.name}</div>
                <div className="text-xs text-slate-400 leading-relaxed mb-3">{m.desc}</div>
                <div className="text-[11px] text-indigo-400 flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                  Modülü aç <ArrowRight className="w-3 h-3"/>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PaymentOptions() {
  const [method, setMethod] = useState("paytr");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(199);
  const cfg = useQuery({ queryKey: ["payment-config"], queryFn: api.paymentConfig });
  const [havaleData, setHavaleData] = useState(null);
  const [iframeSrc, setIframeSrc] = useState(null);

  const paytr = useMutation({
    mutationFn: () => api.paytrCreate({
      email, user_name: name || "Kullanıcı",
      user_address: "Türkiye", user_phone: "05555555555",
      items: [{ name: `GökyüzüWebSpam Lisans`, price: amount, qty: 1 }],
      test_mode: 1, currency: "TL", lang: "tr",
    }),
    onSuccess: (d) => {
      setIframeSrc(d.iframe_src);
      toast.success(d.mock ? "Test modu — mock iframe" : "PayTR sayfası hazır");
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Ödeme başlatılamadı"),
  });

  const havale = useMutation({
    mutationFn: () => api.havaleCreate({
      email, user_name: name || "Kullanıcı", amount,
      plan: "starter", note: "Landing ödeme",
    }),
    onSuccess: (d) => {
      setHavaleData(d);
      toast.success("Havale talebi oluşturuldu");
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "İşlem başarısız"),
  });

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("Kopyalandı");
  };

  return (
    <section id="payment" className="py-24 border-t border-slate-800/60 relative overflow-hidden" data-testid="landing-payment">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_50%,rgba(16,185,129,0.08),transparent_60%)]"/>
      <div className="max-w-5xl mx-auto px-6 relative">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="text-xs uppercase tracking-widest text-emerald-400 mono mb-2">Ödeme Seçenekleri</div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3 tracking-tight">
            Hızlıca satın alın · TL cinsinden
          </h2>
          <p className="text-slate-400">
            PayTR ile anında kartla ödeme (Visa/Mastercard/Troy) veya Havale/EFT ile.
          </p>
        </div>

        {/* Method tabs */}
        <div className="flex justify-center gap-2 mb-8">
          <button onClick={() => { setMethod("paytr"); setIframeSrc(null); setHavaleData(null); }}
                  data-testid="pay-tab-paytr"
                  className={`px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-all ${
                    method === "paytr"
                      ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40"
                      : "bg-slate-800/40 text-slate-400 border border-slate-800 hover:border-slate-700"
                  }`}>
            <CreditCard className="w-4 h-4"/> PayTR · Kartla Öde
          </button>
          <button onClick={() => { setMethod("havale"); setIframeSrc(null); setHavaleData(null); }}
                  data-testid="pay-tab-havale"
                  className={`px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-all ${
                    method === "havale"
                      ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
                      : "bg-slate-800/40 text-slate-400 border border-slate-800 hover:border-slate-700"
                  }`}>
            <Building2 className="w-4 h-4"/> Havale / EFT
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Form */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-3">
            <div className="text-sm font-semibold text-slate-100 mb-1">Bilgileriniz</div>
            <input value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="Ad Soyad"
                   data-testid="pay-name"
                   className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-100 focus:outline-none focus:border-indigo-500"/>
            <input value={email} onChange={(e) => setEmail(e.target.value)}
                   placeholder="E-posta adresi"
                   data-testid="pay-email"
                   type="email"
                   className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-100 focus:outline-none focus:border-indigo-500"/>
            <div className="flex gap-2">
              <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))}
                     data-testid="pay-amount"
                     className="flex-1 px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-100 mono focus:outline-none focus:border-indigo-500"/>
              <span className="px-3 py-2.5 bg-slate-800 border border-slate-800 rounded-md text-sm text-slate-400 mono">TL</span>
            </div>
            {method === "paytr" ? (
              <button onClick={() => paytr.mutate()} disabled={!email || paytr.isPending}
                      data-testid="pay-paytr-submit"
                      className="w-full mt-2 px-4 py-3 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-medium shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 disabled:opacity-40 inline-flex items-center justify-center gap-2">
                <CreditCard className="w-4 h-4"/>
                {paytr.isPending ? "İşleniyor..." : `${amount} TL Kartla Öde`}
              </button>
            ) : (
              <button onClick={() => havale.mutate()} disabled={!email || havale.isPending}
                      data-testid="pay-havale-submit"
                      className="w-full mt-2 px-4 py-3 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-medium shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 disabled:opacity-40 inline-flex items-center justify-center gap-2">
                <Building2 className="w-4 h-4"/>
                {havale.isPending ? "İşleniyor..." : "Havale Talebi Oluştur"}
              </button>
            )}
            {cfg.data && !cfg.data.paytr_configured && method === "paytr" && (
              <div className="text-[11px] text-amber-300 mt-2 flex items-start gap-1">
                <span>ℹ️</span>
                <span>PayTR test modunda. Canlı kullanım için MERCHANT bilgileri gereklidir.</span>
              </div>
            )}
          </div>

          {/* Result */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 min-h-[260px]">
            {method === "paytr" && !iframeSrc && (
              <div className="text-center text-sm text-slate-500 py-14">
                <CreditCard className="w-12 h-12 text-slate-700 mx-auto mb-3"/>
                Bilgileri girin, ödeme sayfası burada açılacak
              </div>
            )}
            {method === "paytr" && iframeSrc && (
              <div>
                <div className="text-xs text-slate-400 mb-2">PayTR güvenli ödeme:</div>
                <iframe src={iframeSrc} title="paytr" className="w-full h-72 rounded-md bg-white border border-slate-700"
                        data-testid="paytr-iframe"/>
              </div>
            )}
            {method === "havale" && !havaleData && (
              <div className="text-center text-sm text-slate-500 py-14">
                <Building2 className="w-12 h-12 text-slate-700 mx-auto mb-3"/>
                Havale bilgileri talep sonrası burada gösterilecek
              </div>
            )}
            {method === "havale" && havaleData && (
              <HavaleResult havaleData={havaleData} onDone={() => setHavaleData({ ...havaleData, _notified: true })}/>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function BankRow({ label, value, copy }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded px-3 py-2">
      <span className="text-slate-500 uppercase text-[10px] tracking-widest w-16 shrink-0">{label}</span>
      <span className="mono text-slate-100 flex-1 truncate">{value}</span>
      {copy && (
        <button onClick={copy} className="text-slate-400 hover:text-slate-100" title="Kopyala">
          <Copy className="w-3 h-3"/>
        </button>
      )}
    </div>
  );
}

function HavaleResult({ havaleData, onDone }) {
  const [showNotify, setShowNotify] = useState(false);
  const [txRef, setTxRef] = useState("");
  const [sender, setSender] = useState("");
  const [note, setNote] = useState("");
  const notify = useMutation({
    mutationFn: () => api.havaleNotify({
      merchant_oid: havaleData.reference,
      transaction_ref: txRef, sender_name: sender, note,
    }),
    onSuccess: () => {
      toast.success("✓ Bildiriminiz admin'e iletildi. En geç 2 saat içinde onaylanacak.", { duration: 8000 });
      onDone?.();
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Bildirim gönderilemedi"),
  });
  const copy = (t) => { navigator.clipboard.writeText(t); toast.success("Kopyalandı"); };

  if (havaleData._notified) {
    return (
      <div className="text-center py-10" data-testid="havale-notified">
        <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 className="w-8 h-8 text-emerald-400"/>
        </div>
        <div className="text-lg font-semibold text-emerald-300">Bildirim Gönderildi</div>
        <div className="text-xs text-slate-400 mt-2">Ödemeniz doğrulanınca lisansınız otomatik e-postanıza gelecek.</div>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="havale-result">
      <div className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5">
        <CheckCircle2 className="w-4 h-4"/> Havale Bilgileri Hazır
      </div>
      <div className="space-y-1.5 text-xs">
        <BankRow label="Banka" value={havaleData.bank}/>
        <BankRow label="Alıcı" value={havaleData.beneficiary}/>
        <BankRow label="IBAN" value={havaleData.iban} copy={() => copy(havaleData.iban)}/>
        <BankRow label="Tutar" value={`${havaleData.amount} TL`}/>
        <BankRow label="Referans" value={havaleData.reference} copy={() => copy(havaleData.reference)}/>
      </div>
      <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded p-2.5 leading-relaxed">
        ⚠️ Açıklama alanına <b className="mono">{havaleData.reference}</b> yazmayı unutmayın!
      </div>

      {!showNotify ? (
        <button onClick={() => setShowNotify(true)}
                data-testid="havale-notify-open"
                className="w-full mt-2 px-4 py-3 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-medium shadow-lg hover:from-emerald-400 hover:to-emerald-500 inline-flex items-center justify-center gap-2">
          <BadgeCheck className="w-4 h-4"/> Havale Yaptım · Bildir
        </button>
      ) : (
        <div className="space-y-2 mt-2 p-3 bg-slate-950 border border-emerald-500/30 rounded" data-testid="havale-notify-form">
          <div className="text-xs text-slate-300 mb-1">Aşağıdaki bilgileri doldurup admin'e bildirin:</div>
          <input value={txRef} onChange={(e) => setTxRef(e.target.value)}
                 placeholder="Banka referansı / dekont no"
                 data-testid="havale-notify-ref"
                 className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 mono focus:outline-none focus:border-emerald-500"/>
          <input value={sender} onChange={(e) => setSender(e.target.value)}
                 placeholder="Gönderen ad soyad (banka hesabındaki)"
                 data-testid="havale-notify-sender"
                 className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:outline-none focus:border-emerald-500"/>
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="İsteğe bağlı not"
                    rows="2"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:outline-none focus:border-emerald-500"/>
          <button onClick={() => notify.mutate()} disabled={notify.isPending}
                  data-testid="havale-notify-submit"
                  className="w-full px-4 py-2 rounded bg-emerald-500 text-white font-medium disabled:opacity-40 text-sm inline-flex items-center justify-center gap-2">
            <BadgeCheck className="w-4 h-4"/>
            {notify.isPending ? "Gönderiliyor..." : "Admin'e Bildir"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Landing() {
  const { effective } = useI18n();
  const theme = useLandingTheme();
  const isLight = theme === "light";
  return (
    <div
      className={`min-h-screen ${isLight ? "gws-landing-light bg-[#fef8f0] text-slate-800" : "bg-slate-950 text-slate-100"} ${effective === "ar" ? "rtl" : ""}`}
      dir={effective === "ar" ? "rtl" : "ltr"}
      data-landing-theme={theme}
      data-testid="landing-page"
    >
      {/* v43.9 Light theme — sıcak krem/soft-blue palet için Tailwind override'ları.
          Sadece .gws-landing-light kapsayıcısı içindeyken devreye girer, panel/dashboard etkilenmez. */}
      {isLight && <LandingLightThemeStyles />}
      <NavBar />
      <Hero />
      <BlockedTrendWidget />
      <ActivityHeatmap />
      <CostSavingsWidget />
      <AchievementBadges />
      <Features />
      <ModulesShowcase />
      <ModuleTourCTA />
      <GeoBlockedHeatmap />
      <Stats />
      <HowItWorks />
      <Pricing />
      <PaymentOptions />
      <FAQ />
      <Testimonials />
      <CTABottom />
      <Footer />
      <FloatingPanelButton />
      <LicenseEntryModal />
      <LiveTicker />
    </div>
  );
}

/**
 * v43.9 Sıcak, davetkâr light temayı slate-star/text-slate-star class'larını hedefleyen
 * bir style overlay ile uygular. Tailwind class'larını yeniden yazmadan çalışır.
 * Hero: krem-mavi gradient; nav/section arkaları: yumuşak beyaz; card: cream + soft border.
 */
function LandingLightThemeStyles() {
  return (
    <style>{`
      .gws-landing-light {
        --gws-page-bg: linear-gradient(180deg, #fef8f0 0%, #fdf2e9 45%, #eaf3ff 100%);
        background: var(--gws-page-bg) !important;
        color: #1e293b;
      }
      /* Nav & sticky header */
      .gws-landing-light header[data-testid="landing-nav"] {
        background: rgba(255,255,255,0.85) !important;
        border-bottom-color: #fde3c4 !important;
      }
      /* Section borders and translucent backdrops */
      .gws-landing-light .border-slate-800,
      .gws-landing-light .border-slate-800\\/60,
      .gws-landing-light .border-slate-700 { border-color: #fde3c4 !important; }
      .gws-landing-light .bg-slate-950,
      .gws-landing-light .bg-slate-950\\/60,
      .gws-landing-light .bg-slate-950\\/70,
      .gws-landing-light .bg-slate-950\\/80,
      .gws-landing-light .bg-slate-950\\/40 { background-color: rgba(255,251,244,0.85) !important; }
      .gws-landing-light .bg-slate-900,
      .gws-landing-light .bg-slate-900\\/40,
      .gws-landing-light .bg-slate-900\\/60 { background-color: rgba(255,255,255,0.78) !important; }
      .gws-landing-light .bg-slate-800,
      .gws-landing-light .bg-slate-800\\/40,
      .gws-landing-light .bg-slate-800\\/60 { background-color: rgba(253,242,229,0.7) !important; }
      /* Text: darken slate-* on light */
      .gws-landing-light .text-slate-100 { color: #0f172a !important; }
      .gws-landing-light .text-slate-300 { color: #334155 !important; }
      .gws-landing-light .text-slate-400 { color: #475569 !important; }
      .gws-landing-light .text-slate-500 { color: #64748b !important; }
      .gws-landing-light .text-slate-600 { color: #94a3b8 !important; }
      /* Hover states from slate → warm cream */
      .gws-landing-light .hover\\:text-slate-100:hover { color: #1e3a8a !important; }
      .gws-landing-light .hover\\:bg-slate-800\\/60:hover { background-color: rgba(253,230,199,0.6) !important; }
      /* Preserve terminal block (dark on purpose) */
      .gws-landing-light [data-testid="landing-how"] pre { color: #cbd5e1; }
      /* Hero gradient title accent — softer, warmer palette */
      .gws-landing-light [data-testid="landing-hero"] h1 span.bg-clip-text {
        background-image: linear-gradient(90deg, #2563eb, #db2777, #ea580c) !important;
      }
      /* Card shadows — softer, no harsh dark */
      .gws-landing-light [data-testid^="testimonial-"],
      .gws-landing-light [data-testid^="case-"],
      .gws-landing-light [data-testid="landing-features"] > div > div > div {
        box-shadow: 0 4px 20px -6px rgba(30, 58, 138, 0.08);
      }
      /* Footer background */
      .gws-landing-light footer.bg-slate-950 { background: #fef8f0 !important; }
      /* Live LiveTicker floating widget bg */
      .gws-landing-light [data-testid="live-ticker"] { background: rgba(255,255,255,0.92) !important; color: #0f172a; }

      /* --- v43.10 3D LiveBlockCounter — light mode adaptation --- */
      /* Ana banner: koyu gradient yerine sıcak beyaz+rose gradient */
      .gws-landing-light [data-testid="landing-live-block-counter"] > div:first-child {
        background: linear-gradient(135deg, #ffffff 0%, #fef2f2 45%, #fff7ed 100%) !important;
        border-color: #fda4af !important;
        box-shadow:
          0 10px 40px -15px rgba(244,63,94,0.35),
          inset 0 1px 0 0 rgba(255,255,255,0.7),
          0 1px 3px rgba(0,0,0,0.04) !important;
      }
      .gws-landing-light [data-testid="landing-live-today"] {
        background-image: linear-gradient(135deg, #be123c, #db2777, #ea580c) !important;
        -webkit-background-clip: text; background-clip: text;
        color: transparent !important;
      }
      /* Banner ikincil metinler */
      .gws-landing-light [data-testid="landing-live-block-counter"] .text-rose-300,
      .gws-landing-light [data-testid="landing-live-block-counter"] .text-rose-200\\/80 { color: #be123c !important; }
      .gws-landing-light [data-testid="landing-live-block-counter"] .text-emerald-300 { color: #047857 !important; }
      .gws-landing-light [data-testid="landing-live-block-counter"] .border-slate-700\\/50 { border-color: #fecdd3 !important; }

      /* 3D Tile'lar: koyu slate arka plan yerine beyaz cam */
      .gws-landing-light [data-testid^="landing-tile-"] {
        background: rgba(255,255,255,0.85) !important;
        border-color: #e2e8f0 !important;
        box-shadow:
          0 6px 24px -10px rgba(15,23,42,0.15),
          inset 0 1px 0 0 rgba(255,255,255,0.9) !important;
      }
      .gws-landing-light [data-testid^="landing-tile-"]:hover {
        border-color: #cbd5e1 !important;
        box-shadow:
          0 12px 32px -8px var(--glow, rgba(99,102,241,0.35)),
          inset 0 1px 0 0 rgba(255,255,255,0.95) !important;
      }
      /* Tile içi metinler light'ta koyu */
      .gws-landing-light .gws-tile-label { color: #334155 !important; }
      .gws-landing-light .gws-tile-unit  { color: #475569 !important; }
      .gws-landing-light .gws-tile-hint  { color: #64748b !important; }
      /* Tile numaraları light'ta koyu renk versiyonu */
      .gws-landing-light [data-testid^="landing-tile-"] .gws-tile-num.text-orange-200  { color: #c2410c !important; }
      .gws-landing-light [data-testid^="landing-tile-"] .gws-tile-num.text-amber-200   { color: #b45309 !important; }
      .gws-landing-light [data-testid^="landing-tile-"] .gws-tile-num.text-fuchsia-200 { color: #a21caf !important; }
      .gws-landing-light [data-testid^="landing-tile-"] .gws-tile-num.text-rose-200    { color: #be123c !important; }
      .gws-landing-light [data-testid^="landing-tile-"] .gws-tile-num.text-indigo-200  { color: #3730a3 !important; }
      .gws-landing-light [data-testid^="landing-tile-"] .gws-tile-num.text-cyan-200    { color: #0e7490 !important; }
      .gws-landing-light [data-testid^="landing-tile-"] .gws-tile-num.text-purple-200  { color: #7e22ce !important; }

      /* --- SalesTodayBanner light adaptation --- */
      .gws-landing-light .gws-sales-card {
        background: linear-gradient(135deg, #ffffff 0%, #ecfdf5 55%, #d1fae5 100%) !important;
        border-color: #6ee7b7 !important;
        box-shadow: 0 8px 24px -10px rgba(5,150,105,0.35), inset 0 1px 0 0 rgba(255,255,255,0.8) !important;
      }
      .gws-landing-light .gws-sales-label { color: #047857 !important; }
      .gws-landing-light .gws-sales-count {
        background-image: linear-gradient(135deg, #065f46, #047857, #0d9488) !important;
        -webkit-background-clip: text; background-clip: text; color: transparent !important;
      }
      .gws-landing-light .gws-sales-unit { color: #059669 !important; }
      .gws-landing-light .gws-sales-hint { color: #059669 !important; }
      .gws-landing-light .gws-sales-sub  { color: #065f46 !important; }

      .gws-landing-light .gws-recent-card {
        background: linear-gradient(135deg, #ffffff 0%, #eef2ff 55%, #fdf4ff 100%) !important;
        border-color: #c7d2fe !important;
        box-shadow: 0 8px 24px -10px rgba(99,102,241,0.25), inset 0 1px 0 0 rgba(255,255,255,0.85) !important;
      }
      .gws-landing-light .gws-recent-name    { color: #334155 !important; }
      .gws-landing-light .gws-recent-strong  { color: #0f172a !important; }
      .gws-landing-light .gws-recent-city    { color: #475569 !important; }
      .gws-landing-light .gws-recent-time    { color: #64748b !important; }

      /* Aktif lisans pill (banner) — light contrast */
      .gws-landing-light [data-testid="landing-live-block-counter"] .bg-rose-500\\/20 {
        background-color: rgba(254,205,211,0.9) !important;
      }
      .gws-landing-light [data-testid="landing-live-block-counter"] .text-rose-100 { color: #9f1239 !important; }

      /* Live ticker at bottom — always readable */
      .gws-landing-light .text-emerald-100 { color: #065f46 !important; }
      .gws-landing-light .text-emerald-200 { color: #047857 !important; }
      .gws-landing-light .text-indigo-100  { color: #3730a3 !important; }
      .gws-landing-light .text-fuchsia-300 { color: #a21caf !important; }
      .gws-landing-light .text-indigo-300  { color: #4338ca !important; }
    `}</style>
  );
}

function LicenseEntryModal() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // İlk ziyarette otomatik aç (7 gün önce yapıldıysa yine aç)
    const lastSeen = localStorage.getItem("gws.license_modal_dismissed");
    const stored = localStorage.getItem("gws.event_license");
    if (!stored) {
      const now = Date.now();
      const last = lastSeen ? parseInt(lastSeen) : 0;
      if (!last || (now - last) > 7 * 86400000) {
        setTimeout(() => setOpen(true), 1500);
      }
    }
  }, []);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("gws:open-license-modal", handler);
    return () => window.removeEventListener("gws:open-license-modal", handler);
  }, []);

  const submit = async () => {
    if (!key.trim() || !key.trim().startsWith("MS-")) {
      alert("Geçerli bir lisans anahtarı girin (MS-... ile başlamalı)");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/license/master-unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ license_key: key.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("gws.event_license", key.trim());
        localStorage.removeItem("gws.license_modal_dismissed");
        setOpen(false);
        setTimeout(() => window.location.href = "/panel", 500);
      } else {
        alert(data.detail || "Lisans doğrulanamadı");
      }
    } catch (e) {
      alert("Bağlantı hatası: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const dismiss = () => {
    localStorage.setItem("gws.license_modal_dismissed", String(Date.now()));
    setOpen(false);
  };

  return (
    <>
      {/* Sol-alt sabit "Lisans Gir" butonu */}
      <button
        onClick={() => setOpen(true)}
        data-testid="landing-license-btn"
        className="fixed bottom-6 left-6 z-40 inline-flex items-center gap-2 px-4 py-3 rounded-full bg-slate-900/90 backdrop-blur border-2 border-indigo-500/60 text-indigo-100 text-sm font-semibold shadow-2xl shadow-indigo-500/30 hover:bg-indigo-500/20 hover:shadow-indigo-500/50 hover:-translate-y-0.5 transition-all"
      >
        <span className="text-lg leading-none">🔑</span>
        <span className="hidden md:inline">Lisans Gir</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          data-testid="license-entry-modal"
          onClick={dismiss}
        >
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"/>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-slate-900 border border-indigo-500/40 rounded-2xl shadow-2xl shadow-indigo-500/30"
          >
            {/* Üstte parlayan gradient */}
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-indigo-400 to-transparent"/>

            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-bold uppercase tracking-widest text-indigo-300 mb-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"/>
                    Lisans Doğrulama
                  </div>
                  <h2 className="text-2xl font-bold text-white leading-tight">
                    Hoş Geldiniz 👋
                  </h2>
                  <p className="text-sm text-slate-400 mt-1.5">
                    Panele erişmek için lisans anahtarınızı girin
                  </p>
                </div>
                <button
                  onClick={dismiss}
                  className="text-slate-500 hover:text-slate-200 text-2xl leading-none"
                >×</button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5 block">
                    Lisans Anahtarı
                  </label>
                  <input
                    autoFocus
                    value={key}
                    onChange={(e) => setKey(e.target.value.trim())}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    placeholder="MS-XXXXXXXXXXXXXXXXXXXXXXXX"
                    className="w-full bg-slate-950/80 border-2 border-slate-800 rounded-xl px-4 py-3 text-sm mono text-slate-100 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500/60 focus:shadow-lg focus:shadow-indigo-500/20 transition-all"
                    data-testid="license-entry-input"
                  />
                  <p className="text-[10px] text-slate-500 mt-2">
                    💡 MS- ile başlayan 24 karakterlik anahtar
                  </p>
                </div>

                <button
                  onClick={submit}
                  disabled={loading || !key}
                  data-testid="license-entry-submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-semibold shadow-lg shadow-indigo-500/40 hover:shadow-indigo-500/60 hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 transition-all"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                      Doğrulanıyor...
                    </>
                  ) : (
                    <>
                      🔓 Panel'e Gir
                      <span className="text-lg">→</span>
                    </>
                  )}
                </button>

                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="flex-1 h-px bg-slate-800"/>
                  <span>veya</span>
                  <span className="flex-1 h-px bg-slate-800"/>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <a
                    href="/shop"
                    data-testid="landing-modal-buy"
                    className="text-center px-2 py-2 rounded-lg border border-slate-800 bg-slate-900/50 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-200 transition"
                  >
                    🛒 Lisans Al
                  </a>
                  <a
                    href={key && key.startsWith("MS-") ? `/install?key=${encodeURIComponent(key)}` : "/install"}
                    data-testid="landing-modal-install"
                    className="text-center px-2 py-2 rounded-lg border border-slate-800 bg-slate-900/50 text-slate-300 hover:border-amber-500/40 hover:text-amber-200 transition"
                  >
                    🖥️ Kurulum
                  </a>
                  <a
                    href="mailto:destek@gokyuzubilgisayar.com"
                    className="text-center px-2 py-2 rounded-lg border border-slate-800 bg-slate-900/50 text-slate-300 hover:border-indigo-500/40 hover:text-indigo-200 transition"
                  >
                    💬 Yardım
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FloatingPanelButton() {
  return (
    <Link
      to="/panel"
      data-testid="floating-panel-btn"
      className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-semibold shadow-2xl shadow-emerald-500/40 hover:shadow-emerald-500/60 hover:-translate-y-0.5 transition-all group"
    >
      <ShieldAlert className="w-4 h-4"/>
      <span className="hidden md:inline">Panele Dön</span>
      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform"/>
    </Link>
  );
}

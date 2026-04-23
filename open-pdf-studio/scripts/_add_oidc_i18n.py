"""Idempotent script: add the OIDC-migration i18n keys to every locale's
ribbon.json → ai subtree.

The new keys are English-default for locales we don't have native strings
for; the app's i18n falls back to English anyway, so this doesn't break
anything — it just means users see English until a native string lands.
"""

from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent / "js" / "i18n" / "locales"

# Per-locale overrides (native translations we're confident about). Any
# key missing from a locale gets the English default.
NATIVE = {
    "nl": {
        "credits": "credits",
        "creditsResetsAt": "Reset op {{date}}",
        "planFree": "Gratis",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Upgraden",
        "manageAccount": "Account beheren",
    },
    "de": {
        "credits": "Credits",
        "creditsResetsAt": "Zurückgesetzt am {{date}}",
        "planFree": "Kostenlos",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Upgrade",
        "manageAccount": "Konto verwalten",
    },
    "fr": {
        "credits": "crédits",
        "creditsResetsAt": "Réinitialisation le {{date}}",
        "planFree": "Gratuit",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Passer à supérieur",
        "manageAccount": "Gérer le compte",
    },
    "es": {
        "credits": "créditos",
        "creditsResetsAt": "Se reinicia el {{date}}",
        "planFree": "Gratis",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Mejorar",
        "manageAccount": "Gestionar cuenta",
    },
    "pt": {
        "credits": "créditos",
        "creditsResetsAt": "Reinicia em {{date}}",
        "planFree": "Grátis",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Fazer upgrade",
        "manageAccount": "Gerir conta",
    },
    "it": {
        "credits": "crediti",
        "creditsResetsAt": "Azzeramento il {{date}}",
        "planFree": "Gratuito",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Aggiorna",
        "manageAccount": "Gestisci account",
    },
    "pl": {
        "credits": "kredyty",
        "creditsResetsAt": "Reset {{date}}",
        "planFree": "Darmowy",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Ulepsz",
        "manageAccount": "Zarządzaj kontem",
    },
    "tr": {
        "credits": "kredi",
        "creditsResetsAt": "Sıfırlanma: {{date}}",
        "planFree": "Ücretsiz",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Yükselt",
        "manageAccount": "Hesabı yönet",
    },
    "ru": {
        "credits": "кредиты",
        "creditsResetsAt": "Обновление {{date}}",
        "planFree": "Бесплатный",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Улучшить",
        "manageAccount": "Управление аккаунтом",
    },
    "uk": {
        "credits": "кредити",
        "creditsResetsAt": "Оновлення {{date}}",
        "planFree": "Безкоштовний",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Оновити",
        "manageAccount": "Керувати обліковим записом",
    },
    "cs": {
        "credits": "kredity",
        "creditsResetsAt": "Obnovení {{date}}",
        "planFree": "Zdarma",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Upgradovat",
        "manageAccount": "Spravovat účet",
    },
    "sk": {
        "credits": "kredity",
        "creditsResetsAt": "Obnovenie {{date}}",
        "planFree": "Zdarma",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Vylepšiť",
        "manageAccount": "Spravovať účet",
    },
    "ro": {
        "credits": "credite",
        "creditsResetsAt": "Resetare {{date}}",
        "planFree": "Gratuit",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Actualizează",
        "manageAccount": "Gestionează contul",
    },
    "hu": {
        "credits": "kreditek",
        "creditsResetsAt": "Visszaállítás: {{date}}",
        "planFree": "Ingyenes",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Frissítés",
        "manageAccount": "Fiók kezelése",
    },
    "sv": {
        "credits": "krediter",
        "creditsResetsAt": "Återställs {{date}}",
        "planFree": "Gratis",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Uppgradera",
        "manageAccount": "Hantera konto",
    },
    "da": {
        "credits": "kreditter",
        "creditsResetsAt": "Nulstilles {{date}}",
        "planFree": "Gratis",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Opgrader",
        "manageAccount": "Administrer konto",
    },
    "nb": {
        "credits": "kreditter",
        "creditsResetsAt": "Tilbakestilles {{date}}",
        "planFree": "Gratis",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Oppgrader",
        "manageAccount": "Administrer konto",
    },
    "fi": {
        "credits": "krediittejä",
        "creditsResetsAt": "Nollautuu {{date}}",
        "planFree": "Ilmainen",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Päivitä",
        "manageAccount": "Hallitse tiliä",
    },
    "el": {
        "credits": "πιστώσεις",
        "creditsResetsAt": "Επαναφορά {{date}}",
        "planFree": "Δωρεάν",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Αναβάθμιση",
        "manageAccount": "Διαχείριση λογαριασμού",
    },
    "bg": {
        "credits": "кредити",
        "creditsResetsAt": "Нулиране {{date}}",
        "planFree": "Безплатен",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Надстройте",
        "manageAccount": "Управление на акаунта",
    },
    "hr": {
        "credits": "krediti",
        "creditsResetsAt": "Resetira se {{date}}",
        "planFree": "Besplatan",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Nadogradi",
        "manageAccount": "Upravljaj računom",
    },
    "sr": {
        "credits": "кредити",
        "creditsResetsAt": "Ресетује се {{date}}",
        "planFree": "Бесплатан",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Надогради",
        "manageAccount": "Управљај налогом",
    },
    "zh": {
        "credits": "积分",
        "creditsResetsAt": "{{date}} 重置",
        "planFree": "免费",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "升级",
        "manageAccount": "管理账户",
    },
    "ja": {
        "credits": "クレジット",
        "creditsResetsAt": "{{date}} にリセット",
        "planFree": "無料",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "アップグレード",
        "manageAccount": "アカウント管理",
    },
    "ko": {
        "credits": "크레딧",
        "creditsResetsAt": "{{date}}에 재설정",
        "planFree": "무료",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "업그레이드",
        "manageAccount": "계정 관리",
    },
    "ar": {
        "credits": "رصيد",
        "creditsResetsAt": "إعادة تعيين {{date}}",
        "planFree": "مجاني",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "ترقية",
        "manageAccount": "إدارة الحساب",
    },
    "he": {
        "credits": "קרדיטים",
        "creditsResetsAt": "מתאפס ב-{{date}}",
        "planFree": "חינם",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "שדרג",
        "manageAccount": "ניהול חשבון",
    },
    "fa": {
        "credits": "اعتبار",
        "creditsResetsAt": "بازنشانی در {{date}}",
        "planFree": "رایگان",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "ارتقا",
        "manageAccount": "مدیریت حساب",
    },
    "ur": {
        "credits": "کریڈٹس",
        "creditsResetsAt": "{{date}} کو ری سیٹ",
        "planFree": "مفت",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "اپ گریڈ",
        "manageAccount": "اکاؤنٹ کا انتظام",
    },
    "hi": {
        "credits": "क्रेडिट",
        "creditsResetsAt": "{{date}} को रीसेट",
        "planFree": "मुफ़्त",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "अपग्रेड",
        "manageAccount": "खाता प्रबंधित करें",
    },
    "bn": {
        "credits": "ক্রেডিট",
        "creditsResetsAt": "{{date}} এ রিসেট",
        "planFree": "ফ্রি",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "আপগ্রেড",
        "manageAccount": "অ্যাকাউন্ট পরিচালনা",
    },
    "ta": {
        "credits": "கிரெடிட்கள்",
        "creditsResetsAt": "{{date}} அன்று மீட்டமை",
        "planFree": "இலவசம்",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "மேம்படுத்து",
        "manageAccount": "கணக்கை நிர்வகி",
    },
    "th": {
        "credits": "เครดิต",
        "creditsResetsAt": "รีเซ็ต {{date}}",
        "planFree": "ฟรี",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "อัปเกรด",
        "manageAccount": "จัดการบัญชี",
    },
    "vi": {
        "credits": "tín dụng",
        "creditsResetsAt": "Đặt lại vào {{date}}",
        "planFree": "Miễn phí",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Nâng cấp",
        "manageAccount": "Quản lý tài khoản",
    },
    "id": {
        "credits": "kredit",
        "creditsResetsAt": "Direset pada {{date}}",
        "planFree": "Gratis",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Tingkatkan",
        "manageAccount": "Kelola akun",
    },
    "ms": {
        "credits": "kredit",
        "creditsResetsAt": "Ditetapkan semula pada {{date}}",
        "planFree": "Percuma",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Naik taraf",
        "manageAccount": "Urus akaun",
    },
    "sw": {
        "credits": "mikopo",
        "creditsResetsAt": "Itawekwa upya {{date}}",
        "planFree": "Bure",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Pandisha",
        "manageAccount": "Dhibiti akaunti",
    },
    "ca": {
        "credits": "crèdits",
        "creditsResetsAt": "Es reinicia el {{date}}",
        "planFree": "Gratuït",
        "planPro": "Pro",
        "planStudio": "Studio",
        "upgrade": "Millorar",
        "manageAccount": "Gestiona el compte",
    },
}

DEFAULTS = {
    "credits": "credits",
    "creditsResetsAt": "Resets {{date}}",
    "planFree": "Free",
    "planPro": "Pro",
    "planStudio": "Studio",
    "upgrade": "Upgrade",
    "manageAccount": "Manage account",
}

NEW_KEYS = list(DEFAULTS)


def update_locale(locale: str) -> int:
    path = ROOT / locale / "ribbon.json"
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    ai = data.setdefault("ai", {})
    strings = NATIVE.get(locale, {})
    added = 0
    for k in NEW_KEYS:
        if k not in ai:
            ai[k] = strings.get(k, DEFAULTS[k])
            added += 1
    if added:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return added


def main() -> None:
    total = 0
    for loc_dir in sorted(p for p in ROOT.iterdir() if p.is_dir()):
        n = update_locale(loc_dir.name)
        if n:
            print(f"{loc_dir.name}: +{n}")
            total += n
    print(f"total keys added: {total}")


if __name__ == "__main__":
    main()

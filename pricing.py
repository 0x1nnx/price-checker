"""
Калкулатор за препоръчана цена на ремонт.

Целта е двама служители при еднакъв ремонт да получат една и съща цена.
Затова служителят не избира коефициент — той отговаря на конкретни въпроси
(да/не), а системата сама изчислява коефициента.

Формула:
    труд = базов труд × коефициент на устройството × коефициент на състоянието
    труд = ограничаване в [min_labor, max_labor]
    при няколко ремонта наведнъж — тежести 100% / 50% / 30%
    труд = закръгляне до 5 €

    крайна цена = части + труд + допълнителни услуги − отстъпка

Изключение — самостоятелна смяна на дисплей:
    крайна цена = множител × дисплей + 30 € + 10% от дисплея
    множителят зависи от класа на дисплея:
        до 50 €     → 2.0   (дисплей + 100%)
        50–100 €    → 1.5   (дисплей + 50%)
        над 100 €   → 1.1   (дисплей + 10%)
    крайна цена = не по-малко от 50 €
    (коефициентите за устройство и състояние и закръглянето до 5 € отпадат)

Изключение — самостоятелна смяна на батерия:
    крайна цена = 2 × батерия + фиксирано + процент от батерията
        до 20 €     → 2 × батерия + 20 € + 20%
        20–35 €     → 2 × батерия + 15 € + 10%
        над 35 €    → 2 × батерия + 10 €
    (без минимум и без таван спрямо нов телефон)

Каталозите по-долу са нарочно обикновени речници, както конфигурацията на
сайтовете в app.py. Ако някога станат твърде много за ръчна поддръжка,
преминават 1:1 към таблиците repair_types / device_models.
"""

import math
from typing import Any

# ---------------------------------------------------------------------------
# 1. Базова цена за труд по операция (€)
#    min_labor / max_labor ограничават резултата, за да няма абсурдни цени.
#    Над max_labor системата иска одобрение от управител.
# ---------------------------------------------------------------------------
REPAIR_TYPES: dict[str, dict[str, Any]] = {
    "display": {
        "name": "Смяна на дисплей",
        "base_labor": 20, "min_labor": 15, "max_labor": 40, "minutes": 45,
    },
    "battery": {
        "name": "Смяна на батерия",
        "base_labor": 15, "min_labor": 10, "max_labor": 30, "minutes": 30,
    },
    "camera": {
        "name": "Смяна на камера",
        "base_labor": 18, "min_labor": 13, "max_labor": 35, "minutes": 40,
    },
    "charging_port": {
        "name": "Смяна на букса",
        "base_labor": 25, "min_labor": 18, "max_labor": 50, "minutes": 60,
    },
    "back_cover": {
        "name": "Смяна на заден капак",
        "base_labor": 20, "min_labor": 15, "max_labor": 40, "minutes": 45,
    },
    "earpiece": {
        "name": "Смяна на слушалка",
        "base_labor": 15, "min_labor": 10, "max_labor": 30, "minutes": 30,
    },
    "diagnostics": {
        "name": "Диагностика",
        "base_labor": 13, "min_labor": 13, "max_labor": 20, "minutes": 20,
    },
    "microsoldering": {
        "name": "Микрозапояване",
        "base_labor": 40, "min_labor": 30, "max_labor": 80, "minutes": 120,
    },
}

# Временно достъпни операции. Останалите остават дефинирани по-горе, но не
# се предлагат в калкулатора и не се приемат от API-то. За да се върне някоя,
# се добавя ключът ѝ тук.
ENABLED_REPAIRS: list[str] = ["display", "battery"]

# ---------------------------------------------------------------------------
# 2. Коефициент за сложност на устройството
# ---------------------------------------------------------------------------
DEVICE_MODELS: dict[str, dict[str, Any]] = {
    "generic":            {"brand": "—",       "model": "Друго устройство", "factor": 1.00},
    "samsung_a15":        {"brand": "Samsung", "model": "A15",              "factor": 1.00},
    "samsung_a55":        {"brand": "Samsung", "model": "A55",              "factor": 1.10},
    "samsung_s24":        {"brand": "Samsung", "model": "S24",              "factor": 1.30},
    "samsung_s24_ultra":  {"brand": "Samsung", "model": "S24 Ultra",        "factor": 1.40},
    "samsung_fold":       {"brand": "Samsung", "model": "Fold (всички)",    "factor": 1.70},
    "iphone_13":          {"brand": "iPhone",  "model": "13",               "factor": 1.20},
    "iphone_15_pro":      {"brand": "iPhone",  "model": "15 Pro",           "factor": 1.40},
}

# ---------------------------------------------------------------------------
# 3. Състояние — служителят отговаря с да/не, системата смята коефициента.
#    Надбавките се събират: коефициент = 1 + сума на отметнатите.
# ---------------------------------------------------------------------------
CONDITION_FLAGS: dict[str, dict[str, Any]] = {
    "previous_repair":    {"question": "Има ли следи от предишен ремонт?",     "surcharge": 0.15},
    "liquid_damage":      {"question": "Има ли течност или корозия?",          "surcharge": 0.25},
    "deformed_chassis":   {"question": "Корпусът деформиран ли е?",            "surcharge": 0.15},
    "missing_components": {"question": "Има ли липсващи винтове/щитове?",      "surcharge": 0.10},
}

# Тежести при няколко операции при едно разглобяване: най-скъпата се плаща
# 100%, втората 50%, третата и следващите 30%.
MULTI_REPAIR_WEIGHTS = [1.00, 0.50]
MULTI_REPAIR_TAIL_WEIGHT = 0.30

ROUND_TO = 5           # закръгляне на труда до 5 €
MANUAL_OVERRIDE_PCT = 0.10  # ръчна корекция без одобрение: ±10%

# ---------------------------------------------------------------------------
# 4. Фиксирана формула за самостоятелна смяна на дисплей
#    Крайната цена се определя директно от цената на дисплея, а не от базовия
#    труд. Всички класове имат една и съща форма:
#
#        крайна цена = множител × дисплей + 30 € труд + 10% от дисплея
#
#    и се различават само по множителя — колкото по-скъп е дисплеят, толкова
#    по-малко се надгражда върху него:
#
#        до 50 €        евтин клас    2 × дисплей   (= дисплей + 100%)
#        50–100 €       среден клас   1.5 × дисплей (= дисплей + 50%)
#        над 100 €      скъп клас     1.1 × дисплей (= дисплей + 10%)
#
#    Коефициентите за устройство и състояние не участват — затова формулата
#    важи само когато единствената избрана операция е смяна на дисплей.
# ---------------------------------------------------------------------------
DISPLAY_FORMULA_REPAIR = "display"
DISPLAY_FORMULA_FIXED = 30.0      # € труд, еднакъв за всички класове
DISPLAY_FORMULA_PCT = 0.10        # 10% от цената на дисплея, върху всичко
DISPLAY_FORMULA_MIN_PRICE = 50.0  # € — под този праг ремонт не се пуска

# Таван: ремонтът не може да струва повече от половината от цената на нов
# телефон от същия модел. Цената на новия телефон се тегли от магазин
# (виж fetch_new_phone_price в app.py) и се подава отвън — тук стои само
# правилото. Ако цена не е намерена, таван просто няма.
DISPLAY_MAX_PRICE_PCT = 0.50

# max_part = None означава „без горна граница“. Класовете се четат отгоре
# надолу и печели първият, в чиято граница влиза цената на дисплея.
DISPLAY_TIERS: list[dict[str, Any]] = [
    {"key": "budget",  "name": "евтин клас",  "max_part": 50.0,  "multiplier": 2.0},
    {"key": "mid",     "name": "среден клас", "max_part": 100.0, "multiplier": 1.5},
    {"key": "premium", "name": "скъп клас",   "max_part": None,  "multiplier": 1.1},
]


def display_tier(part_price: float) -> dict[str, Any] | None:
    """Класът, в който попада дисплей с тази цена."""
    if not part_price > 0:
        return None
    for tier in DISPLAY_TIERS:
        if tier["max_part"] is None or part_price <= tier["max_part"]:
            return tier
    return None

# Разпознаване дали намерената част наистина е дисплей. Много аксесоари носят
# думата „дисплей“ в заглавието си („протектор за целия дисплей“, „стикер за
# дисплей“), а за тях цена на ремонт няма смисъл.
#
# Отрицателният списък е водещ: заглавие с „протектор“ отпада, дори да съдържа
# „дисплей“. Нарочно НЕ съдържа „рамка“ и „стъкло“ — истинските дисплеи често
# се продават „с рамка“ или „Тъч скрийн + Рамка“ и щяха да отпаднат погрешно.
DISPLAY_KEYWORDS = ["дисплей", "екран", "display", "lcd", "oled", "screen"]

NON_DISPLAY_KEYWORDS = [
    # аксесоари върху дисплея, не самият дисплей
    "протектор", "стикер", "лепенка", "лепило", "фолио", "тиксо",
    "protector", "sticker", "adhesive", "oca",
    # калъфи и кутии
    "калъф", "кейс", "case",
    # консумативи и инструменти за ремонт
    "поляризатор", "сепаратор", "машина", "инструмент",
    "polarizer", "separator", "machine", "tool",
    # други части, които могат да споменат дисплея
    "заден капак", "back cover",
    "конектор", "конектори", "шлейф", "флекс",
    "connector", "pcb",
]


def display_max_price(new_phone_price: float | None) -> float | None:
    """Таванът на ремонта: половината от цената на нов телефон, ако я знаем."""
    if not new_phone_price or new_phone_price <= 0:
        return None
    return round(new_phone_price * DISPLAY_MAX_PRICE_PCT, 2)


def display_repair_price(
    part_price: float, new_phone_price: float | None = None
) -> float | None:
    """Крайна цена на ремонта по цената на дисплея, или None при невалидна цена.

    Редът е важен: първо формулата по класове, после долният праг, и накрая
    таванът. Така таван под 50 € печели над минимума — при евтин телефон е
    по-логично ремонтът да е под минимума, отколкото да мине над половината
    от стойността на самия телефон.
    """
    tier = display_tier(part_price)
    if tier is None:
        return None
    price = (
        part_price * tier["multiplier"]
        + DISPLAY_FORMULA_FIXED
        + part_price * DISPLAY_FORMULA_PCT
    )
    price = max(price, DISPLAY_FORMULA_MIN_PRICE)

    cap = display_max_price(new_phone_price)
    if cap is not None:
        price = min(price, cap)
    return round(price, 2)


def display_formula_config() -> dict[str, Any]:
    """Параметрите на формулата — фронтендът смята с тях върху цените от търсенето."""
    return {
        "tiers": DISPLAY_TIERS,
        "fixed": DISPLAY_FORMULA_FIXED,
        "pct": DISPLAY_FORMULA_PCT,
        "min_price": DISPLAY_FORMULA_MIN_PRICE,
        "max_price_pct": DISPLAY_MAX_PRICE_PCT,
        "keywords": DISPLAY_KEYWORDS,
        "exclude_keywords": NON_DISPLAY_KEYWORDS,
    }


def display_formula_applies(repairs: list[str], parts_total: float) -> bool:
    """Формулата важи само при самостоятелна смяна на дисплей с известна цена."""
    return (
        list(dict.fromkeys(repairs)) == [DISPLAY_FORMULA_REPAIR]
        and parts_total > 0
    )


# ---------------------------------------------------------------------------
# 5. Фиксирана формула за самостоятелна смяна на батерия
#    Множителят е еднакъв (2 × батерия), а класовете се различават по
#    фиксираната сума и процента от цената на батерията:
#
#        до 20 €        евтин клас    2 × батерия + 20 € + 20% от батерията
#        20–35 €        среден клас   2 × батерия + 15 € + 10% от батерията
#        над 35 €       висок клас    2 × батерия + 10 €
#
#    За разлика от дисплея няма минимум и няма таван спрямо нов телефон.
# ---------------------------------------------------------------------------
BATTERY_FORMULA_REPAIR = "battery"

# Същата логика като DISPLAY_TIERS: max_part = None е „без горна граница“,
# печели първият клас, в чиято граница влиза цената.
BATTERY_TIERS: list[dict[str, Any]] = [
    {"key": "budget",  "name": "евтин клас",  "max_part": 20.0, "multiplier": 2.0, "fixed": 20.0, "pct": 0.20},
    {"key": "mid",     "name": "среден клас", "max_part": 35.0, "multiplier": 2.0, "fixed": 15.0, "pct": 0.10},
    {"key": "premium", "name": "висок клас",  "max_part": None, "multiplier": 2.0, "fixed": 10.0, "pct": 0.0},
]

# Като при дисплея — отрицателният списък е водещ. Отпадат капаци, лепенки,
# конектори и външни батерии, които носят думата „батерия“ в заглавието.
BATTERY_KEYWORDS = ["батерия", "battery"]

# Капакът се изключва само като израз („капак батерия“, „заден капак“), не
# като дума — истинските батерии често се продават „с предпазен капак и
# стикер“ и щяха да отпаднат погрешно.
NON_BATTERY_KEYWORDS = [
    # капаци и лепенки около батерията
    "капак батерия", "капак на батерия", "капак за батерия", "заден капак",
    "задно стъкло", "cover", "лепенка", "лепило", "стикер за", "тиксо",
    "adhesive", "sticker",
    # конектори и платки
    "конектор", "шлейф", "флекс", "платка", "кабел", "адаптер",
    "connector", "flex", "pcb", "motherboard", "board", "cable", "adapter",
    # външни батерии, зарядни и калъфи
    "външна", "power bank", "powerbank", "зарядно", "charger",
    "калъф", "кейс", "case",
    # инструменти и тестери
    "инструмент", "тестер", "tool", "tester",
]


def battery_tier(part_price: float) -> dict[str, Any] | None:
    """Класът, в който попада батерия с тази цена."""
    if not part_price > 0:
        return None
    for tier in BATTERY_TIERS:
        if tier["max_part"] is None or part_price <= tier["max_part"]:
            return tier
    return None


def battery_repair_price(part_price: float) -> float | None:
    """Крайна цена на ремонта по цената на батерията, или None при невалидна цена."""
    tier = battery_tier(part_price)
    if tier is None:
        return None
    price = (
        part_price * tier["multiplier"]
        + tier["fixed"]
        + part_price * tier["pct"]
    )
    return round(price, 2)


def battery_formula_config() -> dict[str, Any]:
    """Параметрите на формулата — фронтендът смята с тях върху цените от търсенето."""
    return {
        "tiers": BATTERY_TIERS,
        "keywords": BATTERY_KEYWORDS,
        "exclude_keywords": NON_BATTERY_KEYWORDS,
    }


def battery_formula_applies(repairs: list[str], parts_total: float) -> bool:
    """Формулата важи само при самостоятелна смяна на батерия с известна цена."""
    return (
        list(dict.fromkeys(repairs)) == [BATTERY_FORMULA_REPAIR]
        and parts_total > 0
    )


def round_to_nearest(value: float, step: int = ROUND_TO) -> int:
    """Закръгляне нагоре при .5 (round() в Python закръгля 2.5 -> 2)."""
    return int(math.floor(value / step + 0.5) * step)


def condition_factor(flags: list[str]) -> tuple[float, list[dict[str, Any]]]:
    """Коефициент на състоянието от отметнатите въпроси."""
    factor = 1.0
    applied = []
    for key in flags:
        flag = CONDITION_FLAGS.get(key)
        if not flag:
            continue
        factor += flag["surcharge"]
        applied.append({"key": key, "question": flag["question"], "surcharge": flag["surcharge"]})
    return round(factor, 4), applied


def labor_for_repair(repair_key: str, device_factor: float, cond_factor: float) -> dict[str, Any]:
    """Труд за една операция, преди тежестите за комбиниран ремонт."""
    repair = REPAIR_TYPES[repair_key]
    raw = repair["base_labor"] * device_factor * cond_factor

    labor = raw
    over_max = raw > repair["max_labor"]
    if labor < repair["min_labor"]:
        labor = repair["min_labor"]
    elif over_max:
        labor = repair["max_labor"]

    return {
        "repair": repair_key,
        "name": repair["name"],
        "base_labor": repair["base_labor"],
        "raw_labor": round(raw, 2),
        "labor": round(labor, 2),
        "minutes": repair["minutes"],
        "clamped_to_min": raw < repair["min_labor"],
        "over_max": over_max,
    }


def quote(
    repairs: list[str],
    device: str = "generic",
    conditions: list[str] | None = None,
    parts_total: float = 0.0,
    extras: float = 0.0,
    discount: float = 0.0,
    manual_labor: float | None = None,
) -> dict[str, Any]:
    """Пълна калкулация за една поръчка."""
    if not repairs:
        raise ValueError("Няма избрана операция")

    unknown = [r for r in repairs if r not in REPAIR_TYPES]
    if unknown:
        raise ValueError(f"Непозната операция: {', '.join(unknown)}")

    disabled = [r for r in repairs if r not in ENABLED_REPAIRS]
    if disabled:
        names = ", ".join(REPAIR_TYPES[r]["name"] for r in disabled)
        raise ValueError(f"Операцията не е достъпна в момента: {names}")

    device_row = DEVICE_MODELS.get(device) or DEVICE_MODELS["generic"]
    device_f = device_row["factor"]
    cond_f, cond_applied = condition_factor(conditions or [])

    # Всяка операция поотделно, после подредени по цена — най-скъпата носи
    # 100% труд, защото останалите се правят при същото разглобяване.
    lines = [labor_for_repair(r, device_f, cond_f) for r in dict.fromkeys(repairs)]
    lines.sort(key=lambda l: l["labor"], reverse=True)

    for i, line in enumerate(lines):
        weight = MULTI_REPAIR_WEIGHTS[i] if i < len(MULTI_REPAIR_WEIGHTS) else MULTI_REPAIR_TAIL_WEIGHT
        line["weight"] = weight
        line["applied_labor"] = round(line["labor"] * weight, 2)

    suggested_labor = round_to_nearest(sum(l["applied_labor"] for l in lines))

    # Самостоятелна смяна на дисплей до 50 € част минава по фиксираната
    # формула: крайна цена = 2 × дисплей + 30 € + 10% от дисплея.
    # Трудът се извежда обратно от нея (крайна цена − част), за да остане
    # разбивката последователна. Тук нарочно няма закръгляне до 5 €, иначе
    # крайната цена нямаше да излиза точно по формулата.
    formula: dict[str, Any] | None = None
    if display_formula_applies(repairs, parts_total):
        repair_price = display_repair_price(parts_total)
        suggested_labor = round(repair_price - parts_total, 2)
        tier = display_tier(parts_total)
        formula = {
            "key": tier["key"],
            "name": f"Смяна на дисплей — {tier['name']}",
            "part_price": round(parts_total, 2),
            "multiplier": tier["multiplier"],
            "fixed": DISPLAY_FORMULA_FIXED,
            "pct": DISPLAY_FORMULA_PCT,
            "repair_price": repair_price,
            "min_price": DISPLAY_FORMULA_MIN_PRICE,
            "at_min": repair_price == DISPLAY_FORMULA_MIN_PRICE,
            "labor": suggested_labor,
        }
    elif battery_formula_applies(repairs, parts_total):
        # Същият подход като при дисплея: трудът = крайна цена − част.
        repair_price = battery_repair_price(parts_total)
        suggested_labor = round(repair_price - parts_total, 2)
        tier = battery_tier(parts_total)
        formula = {
            "key": tier["key"],
            "name": f"Смяна на батерия — {tier['name']}",
            "part_price": round(parts_total, 2),
            "multiplier": tier["multiplier"],
            "fixed": tier["fixed"],
            "pct": tier["pct"],
            "repair_price": repair_price,
            "min_price": None,
            "at_min": False,
            "labor": suggested_labor,
        }

    approval_reasons = []
    # При формулата трудът не идва от base_labor, така че таванът на
    # операцията не е повод за одобрение.
    if formula is None:
        for line in lines:
            if line["over_max"]:
                approval_reasons.append(
                    f"{line['name']}: {line['raw_labor']:.2f} € над максимума "
                    f"({REPAIR_TYPES[line['repair']]['max_labor']} €)"
                )

    # Ръчна корекция — свободна в рамките на ±10%, извън тях иска одобрение.
    lo = round_to_nearest(suggested_labor * (1 - MANUAL_OVERRIDE_PCT))
    hi = round_to_nearest(suggested_labor * (1 + MANUAL_OVERRIDE_PCT))

    final_labor = suggested_labor
    if manual_labor is not None:
        final_labor = round_to_nearest(manual_labor)
        if not (lo <= final_labor <= hi):
            approval_reasons.append(
                f"Ръчна цена {final_labor} € извън диапазона {lo}–{hi} €"
            )

    return {
        "device": {"key": device, **device_row},
        "device_factor": device_f,
        "condition_factor": cond_f,
        "conditions": cond_applied,
        "lines": lines,
        "estimated_minutes": sum(l["minutes"] for l in lines),
        "suggested_labor": suggested_labor,
        "formula": formula,
        "manual_range": [lo, hi],
        "labor": final_labor,
        "parts_total": round(parts_total, 2),
        "extras": round(extras, 2),
        "discount": round(discount, 2),
        "final_price": round(parts_total + final_labor + extras - discount, 2),
        "requires_approval": bool(approval_reasons),
        "approval_reasons": approval_reasons,
    }


def catalog() -> dict[str, Any]:
    """Каталозите за фронтенда (падащи менюта и въпросите за състоянието)."""
    return {
        "repairs": [
            {"key": k, **REPAIR_TYPES[k]} for k in ENABLED_REPAIRS if k in REPAIR_TYPES
        ],
        "devices": [{"key": k, **v} for k, v in DEVICE_MODELS.items()],
        "conditions": [{"key": k, **v} for k, v in CONDITION_FLAGS.items()],
        "round_to": ROUND_TO,
        "manual_override_pct": MANUAL_OVERRIDE_PCT,
        "display_formula": {"repair": DISPLAY_FORMULA_REPAIR, **display_formula_config()},
        "battery_formula": {"repair": BATTERY_FORMULA_REPAIR, **battery_formula_config()},
    }

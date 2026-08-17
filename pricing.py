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

    approval_reasons = []
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
        "repairs": [{"key": k, **v} for k, v in REPAIR_TYPES.items()],
        "devices": [{"key": k, **v} for k, v in DEVICE_MODELS.items()],
        "conditions": [{"key": k, **v} for k, v in CONDITION_FLAGS.items()],
        "round_to": ROUND_TO,
        "manual_override_pct": MANUAL_OVERRIDE_PCT,
    }

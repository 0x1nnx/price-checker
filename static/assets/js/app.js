let category = "phone";
const $ = id => document.getElementById(id);

$("btnPhone").onclick = () => setCat("phone");
$("btnPc").onclick    = () => setCat("pc");
function setCat(c) {
    category = c;
    $("btnPhone").classList.toggle("active", c === "phone");
    $("btnPc").classList.toggle("active", c === "pc");
}

$("go").onclick = run;
$("q").addEventListener("keydown", e => { if (e.key === "Enter") run(); });

// --- CellPhone BG вход за търговци ---
async function cpRefreshStatus() {
    try {
        const r = await fetch("/api/cellphone/status");
        const d = await r.json();
        $("cpDot").classList.toggle("on", d.logged_in);
        $("cpBtn").title = d.logged_in
            ? `CellPhone BG: ${d.email}`
            : "CellPhone BG — вход за търговци";
        $("cpLogout").hidden = !d.logged_in;
    } catch {}
}
cpRefreshStatus();

$("cpBtn").onclick = () => {
    $("cpModal").hidden = false;
    $("cpMsg").textContent = "";
    $("cpEmail").focus();
};
$("cpCancel").onclick = () => { $("cpModal").hidden = true; };
$("cpModal").onclick = e => { if (e.target === $("cpModal")) $("cpModal").hidden = true; };
document.addEventListener("keydown", e => { if (e.key === "Escape") $("cpModal").hidden = true; });

$("cpSubmit").onclick = async () => {
    const email = $("cpEmail").value.trim();
    const pass = $("cpPass").value;
    if (!email || !pass) { $("cpMsg").textContent = "Въведи e-mail и парола."; return; }

    $("cpSubmit").disabled = true;
    $("cpMsg").textContent = "Влизане…";
    try {
        const r = await fetch("/api/cellphone/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: pass })
        });
        const d = await r.json();
        $("cpMsg").textContent = d.message;
        if (d.ok) {
            $("cpPass").value = "";
            cpRefreshStatus();
            setTimeout(() => { $("cpModal").hidden = true; }, 900);
        }
    } catch (e) {
        $("cpMsg").textContent = "Грешка при заявката: " + e.message;
    } finally {
        $("cpSubmit").disabled = false;
    }
};

$("cpLogout").onclick = async () => {
    await fetch("/api/cellphone/logout", { method: "POST" });
    $("cpMsg").textContent = "Излязохте от CellPhone BG.";
    cpRefreshStatus();
};

// --- Цена на ремонта по цената на частта ---
// Формулата живее в pricing.py; тук се дърпат само параметрите ѝ, за да няма
// два записа на едни и същи числа.
let displayFormula = null;
let batteryFormula = null;

async function loadFormulas() {
    try {
        const [d, b] = await Promise.all([
            fetch("/api/pricing/display-formula"),
            fetch("/api/pricing/battery-formula"),
        ]);
        if (d.ok) displayFormula = await d.json();
        if (b.ok) batteryFormula = await b.json();
    } catch {}
}
loadFormulas();

/**
 * Дали заглавието отговаря на ключовите думи на дадена формула.
 *
 * Много аксесоари носят думата „дисплей“ или „батерия“ в заглавието си —
 * протектори, лепенки, капаци — а за тях цена на ремонт е безсмислена.
 * Затова отрицателният списък е водещ: щом заглавието съдържа някоя от
 * неговите думи, резултатът отпада независимо от останалото.
 */
function matchesFormula(formula, title) {
    if (!formula || !title) return false;
    const low = title.toLowerCase();

    // Латинските думи се търсят по граница, за да не улучат части от
    // артикулни номера; кирилските — като подниз, заради членуването
    // („протектор“ да хваща и „протектори“, „протекторът“).
    const hit = word => /^[Ѐ-ӿ]/.test(word)
        ? low.includes(word)
        : new RegExp(`\\b${word}\\b`, "i").test(low);

    if (formula.exclude_keywords.some(hit)) return false;
    return formula.keywords.some(hit);
}

const isDisplayItem = title => matchesFormula(displayFormula, title);
const isBatteryItem = title => matchesFormula(batteryFormula, title);

/**
 * Крайна цена на ремонта за батерия с дадена цена на частта:
 *     2 × част + фиксирано + процент от частта
 * до 20 € → +20 € +20%, до 35 € → +15 € +10%, над 35 € → +10 €.
 * Без минимум и без таван. Връща null, ако частта е без валидна цена.
 */
function batteryTier(partPrice) {
    if (!batteryFormula || !(partPrice > 0) || !isFinite(partPrice)) return null;
    return batteryFormula.tiers.find(
        t => t.max_part === null || partPrice <= t.max_part
    ) || null;
}

function batteryRepairPrice(partPrice) {
    const tier = batteryTier(partPrice);
    if (!tier) return null;
    return partPrice * tier.multiplier + tier.fixed + partPrice * tier.pct;
}

/**
 * Подсказката на баджа: за какъв ремонт е цената и как точно е сметната
 * за тази част, напр. „Смяна на батерия (евтин клас): 2 × 11.70 € + 20 € +
 * 20% от частта = 45.74 €“.
 */
function repairExplanation(it, price) {
    const p = it._numericPrice;
    const pct = share => share ? ` + ${Math.round(share * 100)}% от частта` : "";
    if (it._isDisplay) {
        const t = displayTier(p);
        let text = `Смяна на дисплей (${t.name}): ${t.multiplier} × ${p.toFixed(2)} €` +
                   ` + ${displayFormula.fixed} €${pct(displayFormula.pct)}`;
        if (price <= displayFormula.min_price + 0.005) text += `, минимум ${displayFormula.min_price} €`;
        return `${text} = ${price.toFixed(2)} €`;
    }
    const t = batteryTier(p);
    return `Смяна на батерия (${t.name}): ${t.multiplier} × ${p.toFixed(2)} €` +
           ` + ${t.fixed} €${pct(t.pct)} = ${price.toFixed(2)} €`;
}

/**
 * Класът, в който попада дисплей с тази цена. Класовете се четат отгоре
 * надолу и печели първият, в чиято граница влиза цената; max_part === null
 * означава „без горна граница“.
 */
function displayTier(partPrice) {
    if (!displayFormula || !(partPrice > 0)) return null;
    return displayFormula.tiers.find(
        t => t.max_part === null || partPrice <= t.max_part
    ) || null;
}

/**
 * Крайна цена на ремонта за дисплей с дадена цена на частта:
 *     множител × част + 30 € + 10% от частта, но не по-малко от 50 €
 * Множителят идва от класа: 2.0 до 50 €, 1.5 до 100 €, 1.1 над 100 €.
 * Връща null, ако частта е без валидна цена.
 */
function repairPrice(partPrice, newPhonePrice) {
    if (!isFinite(partPrice)) return null;
    const tier = displayTier(partPrice);
    if (!tier) return null;

    let price = partPrice * tier.multiplier
              + displayFormula.fixed
              + partPrice * displayFormula.pct;
    price = Math.max(price, displayFormula.min_price);

    // Таван: половината от цената на нов телефон от същия модел. Налага се
    // последен, така че при евтин апарат бие и минимума — по-логично е
    // ремонтът да падне под 50 €, отколкото да мине половината от телефона.
    if (newPhonePrice > 0) {
        price = Math.min(price, newPhonePrice * displayFormula.max_price_pct);
    }
    return price;
}

// Цени на нови телефони по модел: number = намерена, null = моделът не се
// продава нов (тогава таван няма), undefined = още не е питано.
let newPhonePrices = {};

/**
 * Дърпа цените за моделите на показаните резултати и пренанася баджовете.
 *
 * Прави се СЛЕД рисуването, защото заявките към магазина траят секунди —
 * резултатите излизат веднага, а таванът се прилага, щом пристигне.
 */
async function applyPriceCaps(items) {
    const models = [...new Set(
        items.filter(it => it._isDisplay && it.model).map(it => it.model)
    )].filter(m => !(m in newPhonePrices));

    if (!models.length) return;

    try {
        const r = await fetch("/api/phone-prices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ models: models.slice(0, 40) })
        });
        if (!r.ok) return;
        const d = await r.json();
        Object.assign(newPhonePrices, d.prices);
    } catch {
        return;   // без цени просто остава без таван
    }

    for (const it of items) {
        // Таванът важи само за дисплеи — батериите остават по формулата.
        if (!it._badge || !it._isDisplay) continue;
        const capped = repairPrice(it._numericPrice, newPhonePrices[it.model]);
        if (capped === null) continue;
        const wasCapped = capped < it._repairUncapped - 0.005;
        it._badge.innerHTML =
            `<span class="repair-badge-label">${it._repairLabel}</span>${capped.toFixed(2)} €`;
        it._badge.classList.toggle("capped", wasCapped);
        it._badge.title = wasCapped
            ? `Смяна на дисплей — таван: половината от цената на нов ${it.model} (${newPhonePrices[it.model].toFixed(2)} €)`
            : repairExplanation(it, capped);
    }
}

async function run() {
    const q = $("q").value.trim();
    if (q.length < 2) { $("status").textContent = "Въведи поне 2 символа."; return; }

    $("go").disabled = true;
    $("hint").style.display = "none";
    $("results").innerHTML = "";
    $("status").textContent = "Търсене в " + (category === "phone" ? "8" : "3") + " сайта едновременно…";

    try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&category=${category}`);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = await r.json();
        render(data);
    } catch (e) {
        $("status").textContent = "Грешка при заявката: " + e.message;
    } finally {
        $("go").disabled = false;
    }
}

function normalizeToEuro(priceStr, url = "") {
    if (!priceStr || priceStr === "N/A") return "";

    let str = priceStr.trim().replace(/^Цена\s*:\s*/i, '');

    // NOTE: MasterClub decimals are handled on the backend now — its prices arrive
    // as "87.15 € (170.45 лв.)" because <sup> cents get a dot inserted in parse_site().

    // Parses "1 200", "13,50", "782.33" -> number (spaces = thousands, comma = decimal)
    const parseNum = s => parseFloat(s.replace(/\s/g, '').replace(',', '.'));

    // 1) Amount immediately BEFORE the € sign.
    //    Handles: "400 € 782,33 лв" (Bazar), "782.33 лв. / 400 €" (OLX),
    //    "4.24 € / 8.29 лв." (OpenCart shops), "13,50 € 26,40 лв", "1 200 €"
    let m = str.match(/(\d[\d\s]*(?:[\.,]\d{1,2})?)\s*€/);
    if (m) {
        const val = parseNum(m[1]);
        if (!isNaN(val)) return val.toFixed(2) + " €";
    }

    // 2) Amount AFTER the € sign: "€11.50" (MobileSentrix), "€ 12"
    m = str.match(/€\s*(\d[\d\s]*(?:[\.,]\d{1,2})?)/);
    if (m) {
        const val = parseNum(m[1]);
        if (!isNaN(val)) return val.toFixed(2) + " €";
    }

    // 3) BGN only: "264,04 лв", "1 095,26 лв", "820 лв."
    m = str.match(/(\d[\d\s]*(?:[\.,]\d{1,2})?)\s*лв/i);
    if (m) {
        const val = parseNum(m[1]);
        if (!isNaN(val)) return (val / 1.95583).toFixed(2) + " €";
    }

    // 4) Bare number — assume BGN
    m = str.match(/\d[\d\s]*(?:[\.,]\d{1,2})?/);
    if (m) {
        const val = parseNum(m[0]);
        if (!isNaN(val)) return (val / 1.95583).toFixed(2) + " €";
    }

    return str;
}

/**
 * Extracts a numeric value from a formatted price string like "11.50 €".
 * Items with missing/invalid prices return Infinity to sit at the end of sorted lists.
 */
function getNumericEuro(priceStr) {
    if (!priceStr) return Infinity;
    const match = priceStr.match(/(\d+[\.,]?\d*)/);
    if (match) {
        const val = parseFloat(match[0].replace(',', '.'));
        return isNaN(val) || val <= 0 ? Infinity : val;
    }
    return Infinity;
}

function formatItemData(it) {
    let title = it.title || "";
    let price = (it.price && it.price !== "N/A") ? it.price : "";
    let url = it.url || "";

    if (url.includes('masterclub.info')) {
        const mcMatch = title.match(/(.*?)\s*[–\-]\s*(\d+)$/);
        if (mcMatch) {
            title = mcMatch[1].trim();
            if (!price) price = mcMatch[2];
        }
    }

    if (url.includes('cellphone-bg.com')) {
        // "Наличен" отива в badge-а, не в заглавието
        title = title.replace(/Баркод/, ' Баркод').replace(/\s*Наличен\s*$/i, '');
    }

    if (url.includes('bazar.bg')) {
        const locMatch = title.match(/(гр\.|с\.)\s*[А-Яа-я]/i);
        if (locMatch) {
            const tail = title.substring(locMatch.index); 
            title = title.substring(0, locMatch.index).trim(); 

            if (!price) {
                const priceMatch = tail.match(/(\d[\d\s.,]*(?:€|лв).*)/i);
                if (priceMatch) {
                    price = priceMatch[1].split('-')[0].trim();
                }
            }
        }
    }

    if (url.includes('laptopremont.com')) {
        const lrMatch = title.match(/(.*?)\s*:\s*([\d.]+\s*€[\d.]+\s*лв\.)/i);
        if (lrMatch) {
            title = lrMatch[1].trim(); 
            if (!price) price = lrMatch[2].trim();
        } else {
            title = title.replace(/\s*:\s*Онлайн магазин Laptop Remont/i, '').trim();
        }
    }

    if (url.includes('siaifon.com')) {
        if (title.includes("— Цена:")) {
            const parts = title.split("— Цена:");
            title = parts[0].trim();
            if (!price) price = parts[1].trim();
        }
    }

    const dashIndex = title.lastIndexOf(' — ');
    if (dashIndex !== -1) {
        const afterDash = title.substring(dashIndex + 3);
        if (/[€лв]/i.test(afterDash)) {
            title = title.substring(0, dashIndex).trim();
            if (!price) price = afterDash.trim();
        }
    }

    const displayPrice = normalizeToEuro(price, url);
    const numericPrice = getNumericEuro(displayPrice);

    return { displayTitle: title, displayPrice, numericPrice };
}

function render(data) {
    // Всички сайтове се сливат в един общ списък — източникът не се показва
    // отделно, вижда се само URL-то на всеки резултат.
    const items = [];
    let failedSources = 0;

    for (const s of data.results) {
        if (!s.ok) { failedSources++; continue; }
        for (const it of s.items) {
            const formatted = formatItemData(it);
            it._displayTitle = formatted.displayTitle;
            it._displayPrice = formatted.displayPrice;
            it._numericPrice = formatted.numericPrice;
            items.push(it);
        }
    }

    // Общо подреждане: от най-ниска към най-висока цена.
    // Позициите без валидна цена получават Infinity и падат най-отдолу.
    items.sort((a, b) => a._numericPrice - b._numericPrice);

    $("status").innerHTML =
        `Готово: <b>${items.length}</b> резултата` +
        (data.cached ? " · от кеша (мигновено)" : ` · ${data.total_seconds}s`) +
        (failedSources ? ` · ${failedSources} източника не отговориха` : "");

    const card = document.createElement("div");
    card.className = "site-card";

    const body = document.createElement("div");
    body.className = "site-body";

    if (items.length === 0) {
        body.innerHTML = `<div class="empty">Няма намерени резултати</div>`;
    } else {
        for (const it of items) {
            const a = document.createElement("a");
            a.className = "item";
            a.href = it.url;
            a.target = "_blank";
            a.rel = "noopener";

            const badgeClass =
                /^неналичен$/i.test(it._displayPrice) ? "price-badge out" :
                /^наличен$/i.test(it._displayPrice)   ? "price-badge avail" :
                "price-badge";
            const priceBadge = it._displayPrice
                ? `<span class="${badgeClass}">${esc(it._displayPrice)}</span>`
                : '';

            it._isDisplay = isDisplayItem(it._displayTitle);
            it._isBattery = !it._isDisplay && isBatteryItem(it._displayTitle);
            // Дисплеят се рисува без таван; той се прилага в applyPriceCaps,
            // щом цените на новите телефони пристигнат.
            const repair = it._isDisplay ? repairPrice(it._numericPrice)
                         : it._isBattery ? batteryRepairPrice(it._numericPrice)
                         : null;
            it._repairUncapped = repair;

            // Етикетът казва за какъв ремонт е цената, а подсказката — как е сметната.
            it._repairLabel = it._isDisplay ? "смяна на дисплей" : "смяна на батерия";
            const repairBadge = repair !== null
                ? `<span class="repair-badge" title="${esc(repairExplanation(it, repair))}">
                       <span class="repair-badge-label">${it._repairLabel}</span>${repair.toFixed(2)} €
                   </span>`
                : '';

            a.innerHTML = `
                <div class="item-info">
                    <span class="item-title">${esc(it._displayTitle)}</span>
                    <span class="u">${esc(it.url)}</span>
                </div>
                <div class="item-prices">${priceBadge}${repairBadge}</div>
            `;

            it._badge = a.querySelector(".repair-badge");
            body.appendChild(a);
        }
    }

    card.appendChild(body);
    $("results").appendChild(card);

    applyPriceCaps(items);
}

const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

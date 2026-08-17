let category = "phone";
const $ = id => document.getElementById(id);

// --- Режим: търсене на части / калкулатор за ремонт ---
$("modeSearch").onclick = () => setMode("search");
$("modeCalc").onclick   = () => setMode("calc");
function setMode(m) {
    $("modeSearch").classList.toggle("active", m === "search");
    $("modeCalc").classList.toggle("active", m === "calc");
    $("viewSearch").hidden = m !== "search";
    $("viewCalc").hidden   = m !== "calc";
    if (m === "calc") loadCatalog();
}

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
    const total = data.results.reduce((n, s) => n + s.items.length, 0);
    $("status").innerHTML =
        `Готово: <b>${total}</b> резултата` +
        (data.cached ? " · от кеша (мигновено)" : ` · ${data.total_seconds}s`);

    // Process items and attach computed price metrics
    for (const s of data.results) {
        for (const it of s.items) {
            const formatted = formatItemData(it);
            it._displayTitle = formatted.displayTitle;
            it._displayPrice = formatted.displayPrice;
            it._numericPrice = formatted.numericPrice;
        }

        // Sort items inside each site card: lowest price -> highest price
        s.items.sort((a, b) => a._numericPrice - b._numericPrice);

        // Record site minimum price for site-card ordering
        s._minPrice = s.items.length > 0 ? s.items[0]._numericPrice : Infinity;
    }

    // Sort site cards by their lowest available price
    const sorted = [...data.results].sort((a, b) => a._minPrice - b._minPrice);

    const frag = document.createDocumentFragment();

    for (const s of sorted) {
        const card = document.createElement("div");
        card.className = "site-card";

        const head = document.createElement("div");
        head.className = "site-head";
        head.innerHTML =
            `<span class="dot ${s.ok ? "ok" : "err"}"></span>` +
            `<h2>${esc(s.site)}</h2>` +
            `<span class="count">${s.items.length}</span>` +
            `<span class="meta">${s.seconds ?? "–"}s</span>`;
        card.appendChild(head);

        const body = document.createElement("div");
        body.className = "site-body";

        if (!s.ok) {
            body.innerHTML = `<div class="error">${esc(s.error || "Грешка")}</div>`;
        } else if (s.items.length === 0) {
            body.innerHTML = `<div class="empty">Няма намерени резултати</div>`;
        } else {
            for (const it of s.items) {
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

                a.innerHTML = `
                    <div class="item-info">
                        <span class="item-title">${esc(it._displayTitle)}</span>
                        <span class="u">${esc(it.url)}</span>
                    </div>
                    ${priceBadge}
                `;

                body.appendChild(a);
            }
        }
        card.appendChild(body);
        frag.appendChild(card);
    }
    $("results").appendChild(frag);
}

const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- Калкулатор за цена на ремонт ---

let calcCatalog = null;

/** Каталозите се дърпат веднъж при първото отваряне на таба. */
async function loadCatalog() {
    if (calcCatalog) return;
    try {
        const r = await fetch("/api/pricing/catalog");
        if (!r.ok) throw new Error("HTTP " + r.status);
        calcCatalog = await r.json();
        renderCatalog();
    } catch (e) {
        $("calcMsg").textContent = "Каталогът не се зареди: " + e.message;
    }
}

function renderCatalog() {
    $("calcDevice").innerHTML = calcCatalog.devices.map(d =>
        `<option value="${esc(d.key)}">${esc(d.brand)} ${esc(d.model)} — ×${d.factor.toFixed(2)}</option>`
    ).join("");

    $("calcRepairs").innerHTML = calcCatalog.repairs.map(r => `
        <label class="chk">
            <input type="checkbox" name="repair" value="${esc(r.key)}">
            <span class="chk-main">${esc(r.name)}</span>
            <span class="chk-meta">${r.base_labor} € · ${r.minutes} мин</span>
        </label>`).join("");

    $("calcConditions").innerHTML = calcCatalog.conditions.map(c => `
        <label class="chk">
            <input type="checkbox" name="condition" value="${esc(c.key)}">
            <span class="chk-main">${esc(c.question)}</span>
            <span class="chk-meta">+${Math.round(c.surcharge * 100)}%</span>
        </label>`).join("");
}

const checkedValues = name =>
    [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

$("calcGo").onclick = async () => {
    const repairs = checkedValues("repair");
    if (!repairs.length) {
        $("calcMsg").textContent = "Избери поне една операция.";
        $("calcResult").innerHTML = "";
        return;
    }

    const num = id => parseFloat($(id).value) || 0;
    const manual = $("calcManual").value.trim();

    $("calcGo").disabled = true;
    $("calcMsg").textContent = "Изчисляване…";
    try {
        const r = await fetch("/api/pricing/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                repairs,
                device: $("calcDevice").value,
                conditions: checkedValues("condition"),
                parts_total: num("calcParts"),
                extras: num("calcExtras"),
                discount: num("calcDiscount"),
                manual_labor: manual === "" ? null : parseFloat(manual),
            })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || ("HTTP " + r.status));
        $("calcMsg").textContent = "";
        renderQuote(d);
    } catch (e) {
        $("calcMsg").textContent = "Грешка: " + e.message;
        $("calcResult").innerHTML = "";
    } finally {
        $("calcGo").disabled = false;
    }
};

$("calcReset").onclick = () => {
    document.querySelectorAll('#viewCalc input[type="checkbox"]').forEach(i => { i.checked = false; });
    ["calcParts", "calcExtras", "calcDiscount"].forEach(id => { $(id).value = "0"; });
    $("calcManual").value = "";
    $("calcMsg").textContent = "";
    $("calcResult").innerHTML = "";
};

function renderQuote(q) {
    // Защо трудът е такъв: при едно разглобяване втората операция се плаща
    // 50%, третата и следващите 30% — затова показваме и тежестта.
    const rows = q.lines.map(l => {
        const cap = l.over_max ? '<span class="cap over">таван</span>'
                  : l.clamped_to_min ? '<span class="cap min">минимум</span>' : "";
        return `
            <tr>
                <td>${esc(l.name)}${cap}</td>
                <td class="num">${l.base_labor}</td>
                <td class="num">${l.raw_labor.toFixed(2)}</td>
                <td class="num">${l.labor.toFixed(2)}</td>
                <td class="num">×${l.weight.toFixed(2)}</td>
                <td class="num strong">${l.applied_labor.toFixed(2)}</td>
            </tr>`;
    }).join("");

    const conds = q.conditions.length
        ? q.conditions.map(c => `<li>${esc(c.question)} <b>+${Math.round(c.surcharge * 100)}%</b></li>`).join("")
        : "<li>Няма отметнати — устройството е в изправност</li>";

    const approval = q.requires_approval
        ? `<div class="quote-warn">
               <b>Иска одобрение от управител</b>
               <ul>${q.approval_reasons.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
           </div>`
        : "";

    $("calcResult").innerHTML = `
        <div class="site-card">
            <div class="site-head">
                <span class="dot ${q.requires_approval ? "err" : "ok"}"></span>
                <h2>${esc(q.device.brand)} ${esc(q.device.model)}</h2>
                <span class="count">×${q.device_factor.toFixed(2)} устройство</span>
                <span class="count">×${q.condition_factor.toFixed(2)} състояние</span>
                <span class="meta">${q.estimated_minutes} мин</span>
            </div>
            <div class="quote-body">
                <table class="quote-table">
                    <thead>
                        <tr>
                            <th>Операция</th><th class="num">Базов</th><th class="num">Изчислен</th>
                            <th class="num">След лимит</th><th class="num">Тежест</th><th class="num">Труд</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>

                <ul class="quote-conds">${conds}</ul>

                <div class="quote-sums">
                    <div><span>Препоръчан труд</span><b>${q.suggested_labor} €</b></div>
                    <div><span>Свободна корекция</span><b>${q.manual_range[0]}–${q.manual_range[1]} €</b></div>
                    <div><span>Начислен труд</span><b>${q.labor} €</b></div>
                    <div><span>Части</span><b>${q.parts_total.toFixed(2)} €</b></div>
                    <div><span>Допълнителни</span><b>${q.extras.toFixed(2)} €</b></div>
                    <div><span>Отстъпка</span><b>−${q.discount.toFixed(2)} €</b></div>
                </div>

                ${approval}

                <div class="quote-final">
                    <span>Крайна цена</span>
                    <b>${q.final_price.toFixed(2)} €</b>
                </div>
            </div>
        </div>`;
}

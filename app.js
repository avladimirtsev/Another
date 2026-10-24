/* global TON_CONNECT_UI */
// ============================================================
// TELEGRAM INIT
// ============================================================
const tg = window.Telegram?.WebApp;
let initData = "";

if (tg) {
    tg.ready();
    tg.expand();
    initData = tg.initData || "";
} else {
    console.warn("Telegram WebApp SDK не загружен.");
}

// ============================================================
// TON CONNECT INIT
// ============================================================
let tonConnectUI = null;
try {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: 'https://ubiru-backend.a-vladimirtsev.workers.dev/tonconnect-manifest.json',
        buttonRootId: 'ton-connect-button'
    });

    tonConnectUI.onStatusChange(wallet => {
        if (wallet) {
            console.log("✅ Кошелёк подключен!", wallet.account.address);
        } else {
            console.log("❌ Кошелёк отключен.");
        }
    });
} catch (e) {
    console.error("Ошибка инициализации TON Connect:", e);
}

// ============================================================
// API
// ============================================================
const API_BASE = "https://ubiru-backend.a-vladimirtsev.workers.dev";

async function apiPost(path, payload = {}, options = {}) {
    try {
        const res = await fetch(API_BASE + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, initData }),
            ...(options.keepalive ? { keepalive: true } : {})
        });
        if (!res.ok && res.status !== 400 && res.status !== 429) throw new Error("HTTP " + res.status);
        return await res.json();
    } catch (e) {
        console.warn("API error:", path, e);
        return null;
    }
}

async function apiAction(action, extraPayload = {}) {
    const res = await apiPost("/api/progress/" + action, extraPayload);
    if (res && !res.error) applyServerState(res);
    return res;
}

function trackEvent(event, extra = "") {
    apiPost("/api/track", { event, extra }, { keepalive: true });
}

// ============================================================
// КЛЮЧИ LOCALSTORAGE
// ============================================================
const LS_TOTAL_KEY = "ubiru_totalReceived";

function readLocalTotal() {
    try {
        const v = Number(localStorage.getItem(LS_TOTAL_KEY) || 0);
        return Number.isFinite(v) && v >= 0 ? v : 0;
    } catch { return 0; }
}

function writeLocalTotal(v) {
    try { localStorage.setItem(LS_TOTAL_KEY, String(v || 0)); } catch (e) {
        console.error(e);
    }
}

// ============================================================
// СЕРВЕРНЫЙ ПРОГРЕСС
// ============================================================
let SERVER_PROGRESS = {
    withdrawn: false,
    finishValue: null,
    cooldownUntil: 0,
    counter3SpeedVersion: "",
    totalReceived: 0
};

function applyServerState(s) {
    SERVER_PROGRESS.withdrawn = !!s.withdrawn;
    SERVER_PROGRESS.finishValue = (typeof s.finishValue === "number") ? s.finishValue : null;
    SERVER_PROGRESS.cooldownUntil = s.cooldownUntil || 0;
    SERVER_PROGRESS.totalReceived = s.totalReceived || 0;

    if (s.counter3Active) {
        counter3.baseValue = Number(s.counter3CurrentValue) || 0;
        counter3.startDate = Date.now();
        counter3.active    = true;
        counter3.perSecond = COUNTER3_NEW_SPEED;
    } else {
        counter3.baseValue = 0;
        counter3.startDate = null;
        counter3.active    = false;
        counter3.perSecond = COUNTER3_NEW_SPEED;
    }

    renderTotalReceived();
    refreshWithdrawBtn();
    restoreFinishBtn();
}

async function loadProgress() {
    const data = await apiPost("/api/progress/get");
    if (!data) return;
    
    const serverTotal = (typeof data.totalReceived === "number" && data.totalReceived >= 0) ? data.totalReceived : 0;
    const localTotal = readLocalTotal();

    SERVER_PROGRESS = {
        withdrawn:            !!data.withdrawn,
        finishValue:          (typeof data.finishValue === "number") ? data.finishValue : null,
        cooldownUntil:        data.cooldownUntil || 0,
        counter3SpeedVersion: data.counter3SpeedVersion || "",
        totalReceived:        Math.max(serverTotal, localTotal)
    };

    if (data.counter3Active) {
        counter3.baseValue = Number(data.counter3CurrentValue) || 0;
        counter3.startDate = Date.now();
        counter3.active    = true;
        counter3.perSecond = COUNTER3_NEW_SPEED;
    } else {
        counter3.baseValue = 0;
        counter3.startDate = null;
        counter3.active    = false;
        counter3.perSecond = COUNTER3_NEW_SPEED;
    }

    renderTotalReceived();
}

async function saveProgress(keepalive = false) {
    if (counter3.active && counter3.startDate !== null) {
        const now = Date.now();
        const secondsPassed = (now - counter3.startDate) / 1000;
        counter3.baseValue = counter3.baseValue + counter3.perSecond * secondsPassed;
        counter3.startDate = now;
    }
    writeLocalTotal(SERVER_PROGRESS.totalReceived || 0);
    await apiPost("/api/progress/save", {
        withdrawn:            SERVER_PROGRESS.withdrawn,
        finishValue:          SERVER_PROGRESS.finishValue,
        cooldownUntil:        SERVER_PROGRESS.cooldownUntil || 0,
        counter3Base:         counter3.baseValue,
        counter3Start:        counter3.startDate,
        counter3Active:       counter3.active,
        counter3PerSecond:    counter3.perSecond,
        counter3SpeedVersion: COUNTER3_SPEED_VERSION,
        totalReceived:        SERVER_PROGRESS.totalReceived || 0
    }, { keepalive });
}

// ============================================================
// НАСТРОЙКИ СЧЁТЧИКОВ
// ============================================================
const COUNTER3_SPEED_VERSION = "v3";
const COUNTER3_NEW_SPEED = 0.00000000000003237503;
const MIN_WITHDRAW_AMOUNT = 0.00000001;

const counters = [
    {
        el: document.getElementById("counter1"),
        baseValue: 10,
        startDate: new Date("2026-10-13T00:00:00+03:00").getTime(),
        perSecond: 0.00000462962963,
        digits: 4, active: true, id: "counter1"
    },
    {
        el: document.getElementById("counter2"),
        baseValue: 143000000,
        startDate: new Date("2026-10-14T00:00:00+03:00").getTime(),
        perSecond: -0.011,
        digits: 0, active: true, id: "counter2"
    },
    {
        el: document.getElementById("counter3"),
        baseValue: 0,
        startDate: null,
        perSecond: COUNTER3_NEW_SPEED,
        digits: 10, active: false, id: "counter3"
    }
];

const counter3 = counters[2];
const COOLDOWN_MS = 1 * 60 * 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

function getCurrentValue(c) {
    if (!c.active || c.startDate === null) return c.baseValue;
    const secondsPassed = (Date.now() - c.startDate) / 1000;
    return c.baseValue + c.perSecond * secondsPassed;
}

function changeSpeed(c, newSpeed) {
    if (!c.active || c.startDate === null) {
        c.perSecond = newSpeed;
        return;
    }
    const now = Date.now();
    const secondsPassed = (now - c.startDate) / 1000;
    c.baseValue = c.baseValue + c.perSecond * secondsPassed;
    c.startDate = now;
    c.perSecond = newSpeed;
}

async function migrateCounter3Speed(serverVersion) {
    if (serverVersion === COUNTER3_SPEED_VERSION) return;
    changeSpeed(counter3, COUNTER3_NEW_SPEED);
    if (counter3.active) await saveProgress();
}

// ============================================================
// ОТРИСОВКА
// ============================================================
function formatNumber(value, digits) {
    return value.toLocaleString("ru-RU", {
        minimumFractionDigits: digits, maximumFractionDigits: digits
    });
}

function renderDailyGain() {
    const el = document.getElementById("dailyGain1");
    if (!el) return;
    const c = counters[0];
    if (!c.active || typeof c.perSecond !== "number") { el.textContent = ""; return; }
    const gain = c.perSecond * SECONDS_PER_DAY;
    const sign = gain >= 0 ? "+" : "−";
    el.textContent = sign + formatNumber(Math.abs(gain), 4) + " за прошлые сутки";
}

function update() {
    for (const c of counters) {
        if (!c.active || c.startDate === null) {
            c.el.textContent = formatNumber(c.baseValue, c.digits);
            continue;
        }
        c.el.textContent = formatNumber(getCurrentValue(c), c.digits);
    }
    renderDailyGain();
}

const counterTotalEl = document.getElementById("counterTotal");
function renderTotalReceived() {
    if (!counterTotalEl) return;
    counterTotalEl.textContent = formatNumber(
        SERVER_PROGRESS.totalReceived || 0,
        counter3.digits
    );
}
function flashTotalReceived() {
    if (!counterTotalEl) return;
    counterTotalEl.classList.remove("flash");
    void counterTotalEl.offsetWidth; 
    counterTotalEl.classList.add("flash");
}

setInterval(update, 250);
update();

setInterval(() => {
    if (counter3.active) saveProgress();
}, 20 * 1000);

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && counter3.active) {
        saveProgress(true);
    }
});
window.addEventListener("pagehide", () => {
    if (counter3.active) saveProgress(true);
});

// ============================================================
// ЭЛЕМЕНТЫ УПРАВЛЕНИЯ
// ============================================================
const btn = document.getElementById("withdrawBtn");
const finishBtn = document.getElementById("finishBtn");
const voucherBtn = document.getElementById("voucherBtn");
const modal = document.getElementById("confirmModal");
const modalYes = document.getElementById("modalYes");
const modalNo = document.getElementById("modalNo");

function getCooldownUntil() { return SERVER_PROGRESS.cooldownUntil || 0; }
function setCooldownUntil(ts) { SERVER_PROGRESS.cooldownUntil = (ts && ts > Date.now()) ? ts : 0; }

function formatCooldown(msLeft) {
    const totalSec = Math.max(0, Math.ceil(msLeft / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function cooldownRemaining() { return getCooldownUntil() - Date.now(); }

function refreshWithdrawBtn() {
    const left = cooldownRemaining();
    if (left > 0) {
        btn.textContent = "Доступно через " + formatCooldown(left);
        btn.disabled = true;
    } else {
        if (getCooldownUntil() !== 0) setCooldownUntil(0);
        if (SERVER_PROGRESS.withdrawn) setWithdrawBtnActive();
        else setWithdrawBtnDefault();
    }
}
function setWithdrawBtnDefault() {
    btn.textContent = "Получить долю Богатства Страны";
    btn.disabled = false;
}
function setWithdrawBtnActive() {
    btn.textContent = "Вам уже поступает доля Богатства Страны!";
    btn.disabled = true;
}

const FINISH_DEFAULT_TEXT = "Вывести свой доход";
function setFinishBtnDefault(enabled) {
    finishBtn.textContent = FINISH_DEFAULT_TEXT;
    finishBtn.disabled = !enabled;
}
function setFinishBtnFrozen(value) {
    finishBtn.textContent = "Ваша доля равна " + formatNumber(value, counter3.digits);
    finishBtn.disabled = true;
}

function showVoucherBtn(value) {
    voucherBtn.textContent = "Получить ваучер на сумму " + formatNumber(value, counter3.digits);
    voucherBtn.classList.add("show");
    voucherBtn.disabled = false;
}
function hideVoucherBtn() {
    voucherBtn.classList.remove("show");
    voucherBtn.textContent = "";
}

function restoreFinishBtn() {
    if (SERVER_PROGRESS.withdrawn) {
        setFinishBtnDefault(true);
        hideVoucherBtn();
        return;
    }
    if (SERVER_PROGRESS.finishValue !== null) {
        setFinishBtnFrozen(SERVER_PROGRESS.finishValue);
        showVoucherBtn(SERVER_PROGRESS.finishValue);
        return;
    }
    setFinishBtnDefault(false);
    hideVoucherBtn();
}

setInterval(() => {
    if (cooldownRemaining() > 0) { refreshWithdrawBtn(); return; }
    if (btn.disabled && btn.textContent.startsWith("Доступно через")) {
        if (SERVER_PROGRESS.withdrawn) setWithdrawBtnActive();
        else setWithdrawBtnDefault();
    }
}, 1000);

// ============================================================
// КЛИК ПО ПЕРВОЙ КНОПКЕ
// ============================================================
btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    if (cooldownRemaining() > 0) return;
    trackEvent("click1");
    setWithdrawBtnActive();

    counter3.baseValue = 0;
    counter3.startDate = Date.now();
    counter3.active    = true;
    counter3.perSecond = COUNTER3_NEW_SPEED;

    SERVER_PROGRESS.withdrawn     = true;
    SERVER_PROGRESS.finishValue   = null;
    SERVER_PROGRESS.cooldownUntil = 0;

    await saveProgress();

    setFinishBtnDefault(true);
    hideVoucherBtn();
});

function openConfirmModal() {
    modal.classList.add("show");
    document.body.classList.add("modal-open");
    modalNo.focus();
}
function closeConfirmModal() {
    modal.classList.remove("show");
    document.body.classList.remove("modal-open");
}

finishBtn.addEventListener("click", () => {
    if (finishBtn.disabled) return;
    if (getCurrentValue(counter3) <= 0) return;
    openConfirmModal();
});

let finishInProgress = false;

async function performFinish() {
    if (finishInProgress) return;
    finishInProgress = true;
    try {
        const finalValue = getCurrentValue(counter3);
        if (!(finalValue > 0)) return;

        counter3.baseValue = 0;
        counter3.startDate = null;
        counter3.active    = false;
        counter3.el.textContent = formatNumber(0, counter3.digits);

        SERVER_PROGRESS.withdrawn     = false;
        SERVER_PROGRESS.finishValue   = finalValue;
        SERVER_PROGRESS.cooldownUntil = Date.now() + COOLDOWN_MS;

        SERVER_PROGRESS.totalReceived = (SERVER_PROGRESS.totalReceived || 0) + finalValue;

        await saveProgress();

        refreshWithdrawBtn();
        setFinishBtnFrozen(finalValue);
        showVoucherBtn(finalValue);

        renderTotalReceived();
        flashTotalReceived();

        trackEvent("finish", String(finalValue));
        trackEvent("total_received", String(SERVER_PROGRESS.totalReceived));
    } finally {
        finishInProgress = false;
    }
}

modalNo.addEventListener("click", () => closeConfirmModal());
modalYes.addEventListener("click", async () => {
    closeConfirmModal();
    await performFinish();
});
modal.addEventListener("click", (e) => { if (e.target === modal) closeConfirmModal(); });
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeConfirmModal();
});

// ============================================================
// ОБРАБОТКА КНОПКИ ВАУЧЕРА
// ============================================================
voucherBtn.addEventListener("click", async () => {
    if (voucherBtn.disabled) return;
    
    if (SERVER_PROGRESS.finishValue < MIN_WITHDRAW_AMOUNT) {
        alert(`Сумма слишком мала для вывода. Минимум: ${MIN_WITHDRAW_AMOUNT}`);
        return;
    }

    if (!tonConnectUI || !tonConnectUI.account) {
        alert("Сначала подключите ваш TON-кошелек!");
        return;
    }

    const walletAddress = tonConnectUI.account.address;
    voucherBtn.disabled = true;
    const originalText = voucherBtn.textContent;
    voucherBtn.textContent = "Обработка...";

    try {
        const res = await apiAction("claim-voucher", { walletAddress });
        
        if (!res || res.error) {
            alert("Ошибка при получении ваучера. Попробуйте позже.");
            return;
        }

        document.getElementById("modalVoucherAmount").textContent = formatNumber(res.claimedValue || 0, counter3.digits);
        document.getElementById("voucherSuccessModal").classList.add("show");
        document.body.classList.add("modal-open");
        hideVoucherBtn();

    } catch (e) {
        console.error(e);
        alert("Ошибка соединения.");
    } finally {
        voucherBtn.disabled = false;
        voucherBtn.textContent = originalText;
    }
});

document.getElementById("closeVoucherBtn").addEventListener("click", () => {
    document.getElementById("voucherSuccessModal").classList.remove("show");
    document.body.classList.remove("modal-open");
});

document.getElementById("goToChannelBtn").addEventListener("click", () => {
    if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink("https://t.me/ubirus");
    else window.open("https://t.me/ubirus", "_blank");
    document.getElementById("voucherSuccessModal").classList.remove("show");
    document.body.classList.remove("modal-open");
});

// ============================================================
// НОВОСТИ И О ПРОЕКТЕ
// ============================================================
const news = [
    { date: "23.10.2026", text: "⚡️Теперь можно подключать WALT для вывода своего Дохода.", isNew: true },
    { date: "22.10.2026", text: "⚡️Добавлено поле Сумма полученного дохода. Это все Ваши выводы дохода за всё время."},
    { date: "21.10.2026", text: "⚡️Запуск канала. https://t.me/ubirus"},
    { date: "20.10.2026", text: "⚡️Запуск чата."},
    { date: "19.10.2026", text: "⚡️Подключение сервера. Сохранение вашего прогресса с любых устройств."},
    { date: "18.10.2026", text: "💡Скорость прироста Богатства на Вашем счете увеличилась на 2%⚡️."},
    { date: "17.10.2026", text: "⚡️ Запуск Telegram Mini App @ubiru_bot"},
    { date: "16.10.2026", text: "💡Скорость прироста Богатства на Вашем счете увеличилась на 4%⚡️."},
    { date: "15.10.2026", text: "Подключение личного счета."},
    { date: "14.10.2026", text: "Подключение новой страны - Россия🇷🇺." },
    { date: "13.10.2026", text: "⚡️Запуск проекта. Владимир Владимирович передал Проекту свои 1000🪙 и пожелал роста🌱" }
];

function renderNews() {
    const list = document.getElementById("newsList");
    list.innerHTML = "";
    if (!news.length) {
        const empty = document.createElement("li");
        empty.className = "news-item";
        empty.innerHTML = `<span class="news-text" style="color:#64748b">Пока новостей нет</span>`;
        list.appendChild(empty); return;
    }
    for (const item of news) {
        const li = document.createElement("li");
        li.className = "news-item" + (item.isNew ? " new" : "");
        li.innerHTML = `<span class="news-date">${item.date}</span><span class="news-text">${item.text}</span>`;
        list.appendChild(li);
    }
}
renderNews();

const aboutText = [
    { type: "p", html: '<strong>Цель проекта</strong>' },
    { type: "ul", items: ["💡 Обеспечение каждого Безусловным Базовым Доходом.", "💡 Создание благополучного и счастливого Будущего."] },
    { type: "hr" },
    { type: "p", html: '<strong>Правила:</strong>' },
    { type: "ul", items: ["Ваша доля Базового Дохода начисляется автоматически после активации личного счёта.", "Вы можете вывести свою долю.", "После вывода доли действует период охлаждения."] },
    { type: "hr" },
    { type: "p", html: '<strong>Условия:</strong>' },
    { type: "ul", items: ["Безусловный Базовый Доход выплачивается всем, а не только нуждающимся.", "Это постоянная выплата, а не разовая акция.", "Не требуется проверки доходов или обязанности поиска работы."] },
    { type: "hr" },
    { type: "p", html: '<strong>Важно:</strong> Каждый имеет право быть счастливым! Мы помогаем Вам хотя бы немного не переживать за будущее.' }
];

function renderAbout() {
    const box = document.getElementById("aboutContent");
    if (!box) return;
    box.innerHTML = "";
    for (const block of aboutText) {
        if (block.type === "p") {
            const p = document.createElement("p");
            p.innerHTML = block.html;
            box.appendChild(p);
        } else if (block.type === "ul") {
            const ul = document.createElement("ul");
            for (const item of block.items) {
                const li = document.createElement("li");
                li.textContent = item;
                ul.appendChild(li);
            }
            box.appendChild(ul);
        } else if (block.type === "hr") {
            box.appendChild(document.createElement("hr"));
        }
    }
}
renderAbout();

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
(async function init() {
    trackEvent("open");
    await loadProgress();
    await migrateCounter3Speed(SERVER_PROGRESS.counter3SpeedVersion);
    refreshWithdrawBtn();
    restoreFinishBtn();
})();

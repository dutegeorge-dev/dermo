// Сборщик: спрашивает у Ирбиса, что открыть, открывает страницу WB в отдельном окне вашего браузера, читает со страницы
// артикулы товаров (и число товаров продавца) и отправляет в Ирбис. Продавца по артикулу Ирбис узнаёт сам из карточки.
// Между страницами — пауза (задаёт Ирбис). Если WB показывает проверку «Подозрительная активность» — останавливается.

const LOAD_TIMEOUT = 45_000;
let looping = false;
let tabId = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settings() {
  return chrome.storage.local.get({ irbisUrl: "", token: "", running: false, log: [] });
}

async function log(text) {
  const { log: list } = await settings();
  const line = `${new Date().toLocaleTimeString("ru-RU")} ${text}`;
  await chrome.storage.local.set({ log: [line, ...list].slice(0, 60), status: text });
}

async function setRunning(running) {
  await chrome.storage.local.set({ running });
  chrome.action.setBadgeText({ text: running ? "▶" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#1d4ed8" });
}

function apiUrl(base, path) {
  const b = base.trim().replace(/\/+$/, "");
  return `${/\/crm$/.test(b) ? b : `${b}/crm`}/api${path}`;
}

async function api(path, body) {
  const { irbisUrl, token } = await settings();
  if (!irbisUrl || !token) throw new Error("Укажите адрес Ирбиса и ключ сборщика");
  const res = await fetch(apiUrl(irbisUrl, path), {
    method: body ? "POST" : "GET",
    credentials: "omit",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error ?? `Ирбис ответил ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Дождаться, пока вкладка догрузится (status complete), не дольше LOAD_TIMEOUT. */
function waitLoaded(id) {
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };
    const listener = (tid, info) => {
      if (tid === id && info.status === "complete") done(true);
    };
    const timer = setTimeout(() => done(false), LOAD_TIMEOUT);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Страница WB — в отдельном обычном окне (не фоновой вкладке): в скрытой вкладке WB не дорисовывает выдачу.
 * Окно можно отодвинуть, но не сворачивать.
 */
async function open(url) {
  if (tabId !== null) {
    try {
      const loaded = waitLoaded(tabId);
      await chrome.tabs.update(tabId, { url });
      return loaded;
    } catch {
      tabId = null; // окно / вкладку закрыли
    }
  }
  const win = await chrome.windows.create({ url: "about:blank", focused: false, width: 1280, height: 900 });
  tabId = win.tabs[0].id;
  const loaded = waitLoaded(tabId);
  await chrome.tabs.update(tabId, { url });
  return loaded;
}

async function inspect(want) {
  try {
    return await chrome.tabs.sendMessage(tabId, { kind: "inspect", want });
  } catch {
    return null;
  }
}

async function runTask(task) {
  const base = { type: task.type, jobId: task.jobId, categoryId: task.categoryId, q: task.q, page: task.page, supplierId: task.supplierId };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const loaded = await open(task.url);
    await sleep(2500); // выдача дорисовывается после загрузки
    const page = loaded ? await inspect(task.type === "search" ? (task.want ?? 300) : 60) : null;
    if (page?.blocked) return { ...base, blocked: true };
    if (page?.items?.length) return { ...base, items: page.items, ...(page.count ? { count: page.count } : {}) };
    if (page && attempt === 2) return { ...base, items: [] }; // страница открылась, товаров нет — пустая выдача
    await log(`Страница не отдала товары${loaded ? "" : " (не загрузилась)"}, повтор (${attempt}/2)`);
    await sleep(8000);
  }
  return { ...base, failed: "страница WB не загрузилась (2 попытки)" };
}

async function loop() {
  if (looping) return;
  looping = true;
  try {
    while ((await settings()).running) {
      let task;
      try {
        task = (await api("/leadgen/collector/next")).task;
      } catch (e) {
        await log(`Ирбис: ${e.message}`);
        if (e.status === 401) {
          await setRunning(false);
          break;
        }
        await sleep(30_000);
        continue;
      }
      if (task.type === "idle") {
        await log(task.message);
        await sleep(30_000);
        continue;
      }
      await log(task.type === "search" ? `Поиск «${task.query}» — прокручиваю до ${task.want ?? 300} товаров` : `Продавец ${task.supplierId}`);
      const result = await runTask(task);
      try {
        const answer = await api("/leadgen/collector/result", result);
        await log(answer.message);
      } catch (e) {
        await log(`Ирбис не принял результат: ${e.message}`);
      }
      if (result.blocked) {
        await setRunning(false);
        await log("WB показал проверку «Подозрительная активность» — сбор остановлен. Пройдите проверку в окне WB и нажмите «Запустить» снова.");
        if (tabId !== null) chrome.tabs.get(tabId).then((t) => chrome.windows.update(t.windowId, { focused: true })).catch(() => {});
        break;
      }
      const [min, max] = task.delay ?? [6, 15];
      await sleep((min + Math.random() * (max - min)) * 1000);
    }
  } finally {
    looping = false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.kind === "start") {
    setRunning(true).then(() => log("Запущен")).then(() => loop());
    reply({ ok: true });
  } else if (msg?.kind === "stop") {
    setRunning(false).then(() => log("Остановлен"));
    reply({ ok: true });
  }
});

// Service worker Chrome засыпает — будильник раз в 30 с продолжает работу, если сбор запущен.
chrome.alarms.create("irbis-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "irbis-keepalive" && (await settings()).running && !looping) loop();
});
chrome.runtime.onStartup.addListener(async () => {
  if ((await settings()).running) loop();
});

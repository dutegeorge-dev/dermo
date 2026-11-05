// Сборщик: спрашивает у Ирбиса, что открыть, открывает страницу WB в отдельной вкладке вашего браузера, берёт ответ
// поиска / каталога, который страница получила от WB, и отправляет в Ирбис. Между страницами — пауза (задаёт Ирбис).
// Если WB показывает проверку «Подозрительная активность» — останавливается.

const PAGE_TIMEOUT = 30_000;
let looping = false;
let tabId = null;
let pending = null; // { match(msg) → boolean, resolve }

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

async function openInTab(url) {
  if (tabId !== null) {
    try {
      await chrome.tabs.update(tabId, { url });
      return;
    } catch {
      tabId = null; // вкладку закрыли
    }
  }
  // Сначала пустая вкладка: её номер должен быть известен до того, как страница WB начнёт присылать ответы.
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  tabId = tab.id;
  await chrome.tabs.update(tabId, { url });
}

/** Ответ страницы, подходящий к заданию. */
function matcher(task) {
  return (msg) => {
    if (msg.kind === "blocked") return true;
    if (msg.kind !== "capture") return false;
    let u;
    try {
      u = new URL(msg.url);
    } catch {
      return false;
    }
    const products = msg.data?.products ?? msg.data?.data?.products ?? [];
    if (task.type === "search") {
      if (!/search/.test(u.pathname)) return false;
      const q = u.searchParams.get("query");
      const page = Number(u.searchParams.get("page") ?? 1);
      return (!q || q.trim().toLowerCase() === task.query.trim().toLowerCase()) && page === task.page;
    }
    const sup = u.searchParams.get("supplier") ?? u.searchParams.get("supplierId");
    if (sup) return Number(sup) === task.supplierId && Number(u.searchParams.get("page") ?? 1) === 1;
    return products.length > 0 && products.every((p) => Number(p.supplierId) === task.supplierId);
  };
}

function waitForPage(task) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending = null;
      resolve(null);
    }, PAGE_TIMEOUT);
    pending = {
      match: matcher(task),
      resolve: (msg) => {
        clearTimeout(timer);
        pending = null;
        resolve(msg);
      },
    };
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.tab?.id !== tabId || !pending) return;
  if (pending.match(msg)) pending.resolve(msg);
});

async function inspect() {
  try {
    return await chrome.tabs.sendMessage(tabId, { kind: "inspect" });
  } catch {
    return null;
  }
}

async function runTask(task) {
  const base = { type: task.type, jobId: task.jobId, categoryId: task.categoryId, q: task.q, page: task.page, supplierId: task.supplierId };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const waiting = waitForPage(task);
    await openInTab(task.url);
    const msg = await waiting;
    if (msg?.kind === "blocked") return { ...base, blocked: true };
    if (msg?.kind === "capture") return { ...base, data: msg.data };
    // Ответ не перехватился — берём артикулы с самой страницы.
    const page = await inspect();
    if (page?.blocked) return { ...base, blocked: true };
    if (page?.items?.length) return { ...base, items: page.items };
    if (task.type === "search" && page && attempt === 2) return { ...base, items: [] }; // пустая выдача
    await log(`Страница не отдала данные, повтор (${attempt}/2)`);
    await sleep(5000);
  }
  return { ...base, failed: "страница WB не отдала данные за 30 секунд (2 попытки)" };
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
      await log(task.type === "search" ? `Поиск «${task.query}», стр. ${task.page}` : `Продавец ${task.supplierId}`);
      const result = await runTask(task);
      try {
        const answer = await api("/leadgen/collector/result", result);
        await log(answer.message);
      } catch (e) {
        await log(`Ирбис не принял результат: ${e.message}`);
      }
      if (result.blocked) {
        await setRunning(false);
        await log("WB показал проверку «Подозрительная активность» — сбор остановлен. Пройдите проверку во вкладке WB и нажмите «Запустить» снова.");
        if (tabId !== null) chrome.tabs.update(tabId, { active: true }).catch(() => {});
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

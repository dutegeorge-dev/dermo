/**
 * Найти актуальные эндпоинты Wildberries: открывает сайт в браузере (Playwright), делает поиск, открывает карточку
 * товара и страницу продавца и печатает все XHR / fetch-запросы к API WB — из них берутся адреса и версии для
 * server/lib/leadgen/wb-endpoints.json. Запускать с российского IP (сервер) или с WB_PROXY.
 *
 *   cd /tmp && npm i playwright@1 && npx playwright install --with-deps chromium
 *   NODE_PATH=/tmp/node_modules node /var/www/tlkbars/repo/crm/scripts/wb-probe.cjs "сковорода"
 *
 * Playwright в зависимости Ирбиса не входит — ставится отдельно, только для этой проверки.
 *
 * На своём компьютере — видимое окно установленного Google Chrome (отдельный временный профиль, без входа в WB):
 *   npm i playwright@1
 *   node wb-probe.cjs "гиря" --headed
 * Нет Google Chrome — откроется Microsoft Edge; другой браузер на Chromium — --exe="C:\путь\к\browser.exe".
 * Консоль портит кириллицу (Windows с китайской / английской кодировкой) — запросом можно не указывать, по умолчанию «гиря».
 *
 * Браузер ничем не маскируется: если WB не пускает автоматизированный браузер — так и будет видно.
 */

const { chromium } = require("playwright");

const args = process.argv.slice(2);
const headed = args.includes("--headed");
const exe = args.find((a) => a.startsWith("--exe="))?.slice(6).replace(/^"|"$/g, "");
const typed = args.find((a) => !a.startsWith("--"));
// Консоль не в UTF-8 передаёт кириллицу как «????» — тогда берём запрос по умолчанию.
const query = typed && !/^\?+$/.test(typed) ? typed : "гиря";
const proxy = process.env.WB_PROXY ? { server: process.env.WB_PROXY } : undefined;
const INTERESTING = /wb\.ru|wbbasket\.ru|wildberries\.ru\/(webapi|__internal)|suppliers-shipment/;

(async () => {
  let browser;
  if (!headed) browser = await chromium.launch({ proxy });
  else if (exe) browser = await chromium.launch({ headless: false, executablePath: exe, proxy });
  else {
    // Установленный Google Chrome, нет его — Microsoft Edge (есть в любой Windows 10/11).
    for (const channel of ["chrome", "msedge"]) {
      try {
        browser = await chromium.launch({ headless: false, channel, proxy });
        console.log(`Браузер: ${channel === "chrome" ? "Google Chrome" : "Microsoft Edge"}`);
        break;
      } catch (e) {
        if (channel === "msedge") throw new Error(`Не нашёлся ни Chrome, ни Edge — укажите браузер: --exe="C:\\путь\\к\\browser.exe"\n${e.message}`);
      }
    }
  }
  console.log(`Запрос: «${query}»`);
  const page = await browser.newPage({ locale: "ru-RU", viewport: { width: 1366, height: 900 } });
  const seen = new Map();
  page.on("response", async (res) => {
    const type = res.request().resourceType();
    const url = res.url();
    if ((type !== "xhr" && type !== "fetch") || !INTERESTING.test(url) || seen.has(url)) return;
    let keys = "";
    try {
      const json = await res.json();
      keys = Object.keys(json).slice(0, 12).join(", ");
      if (Array.isArray(json.products)) keys += ` | products[0]: ${Object.keys(json.products[0] ?? {}).slice(0, 25).join(", ")}`;
      if (Array.isArray(json.data?.products)) keys += ` | data.products[0]: ${Object.keys(json.data.products[0] ?? {}).slice(0, 25).join(", ")}`;
    } catch {
      /* не JSON */
    }
    seen.set(url, `${res.status()} ${url}${keys ? `\n      ключи: ${keys}` : ""}`);
  });

  const step = async (label, fn) => {
    console.log(`\n=== ${label}`);
    const before = seen.size;
    try {
      await fn();
      await page.waitForTimeout(6000);
    } catch (e) {
      console.log(`  ошибка: ${e.message}`);
    }
    [...seen.values()].slice(before).forEach((l) => console.log(`  ${l}`));
  };

  await step(`Поиск «${query}»`, () => page.goto(`https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded" }));
  await step("Вторая страница выдачи", () => page.goto(`https://www.wildberries.ru/catalog/0/search.aspx?page=2&search=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded" }));
  const link = await page.$eval("a.product-card__link, a[href*='/detail.aspx']", (a) => a.href).catch(() => null);
  if (link) {
    await step("Карточка товара", () => page.goto(link, { waitUntil: "domcontentloaded" }));
    const seller = await page.$eval("a[href*='/seller/']", (a) => a.href).catch(() => null);
    if (seller) await step("Страница продавца", () => page.goto(seller, { waitUntil: "domcontentloaded" }));
    else console.log("\nСсылка на продавца в карточке не найдена.");
  } else {
    console.log(`\nКарточек в выдаче не видно — возможно, антибот («${await page.title()}»): нужен российский IP или WB_PROXY.`);
  }
  await browser.close();
})();

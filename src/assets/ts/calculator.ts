/**
 * Калькулятор стоимости доставки и таможенных платежей (/calculator/).
 *
 * Считает на клиенте и пересчитывает на каждый ввод. Формулы и тарифы не
 * дублируются: модуль импортирует `server/calc.ts` — тот же самый, которым
 * бэкенд пересчитывает заявку перед отправкой в Bitrix24. Курсы валют берутся
 * с бэкенда (GET /api/rates → курсы ЦБ РФ), адрес приходит из вёрстки в
 * data-rates-endpoint на <html>.
 *
 * Расчёт предварительный: ставки пошлины и НДС вводит пользователь, они
 * зависят от кода ТН ВЭД и требуют подтверждения декларантом (об этом
 * написано прямо на странице).
 */

import {
  CALC_CONFIG,
  computeCalculation,
  type CalcInput,
  type CalcItemInput,
  type CalcRates,
  type CalcResult,
} from "../../../server/calc.ts";

import { isValidContact, sendLead, trackEvent } from "./lead";

/** Ответ GET /api/rates. */
interface RatesResponse {
  ok?: boolean;
  usd?: number;
  cny?: number;
  date?: string;
  stale?: boolean;
  error?: string;
}

/** Курсы, на которых сейчас считаем. null — ЦБ ещё не ответил. */
let rates: CalcRates | null = null;

/** Счётчик строк товаров: нужен для уникальных id полей (label → for). */
let itemSeq = 0;

const nfMoney = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const nfRub = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nfVolume = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const nfRate = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Сумма в долларах: «1 234,56 $». */
function usd(value: number): string {
  return `${nfMoney.format(value)} $`;
}

/** Та же сумма в рублях по курсу ЦБ — как вспомогательная строка. */
function rub(value: number): string {
  if (!rates || rates.usd <= 0) return "";
  return `≈ ${nfRub.format(value * rates.usd)} ₽`;
}

/** Дата курса ЦБ (ISO) в привычном виде: 2026-08-14 → 14.08.2026. */
function ruDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso;
}

/**
 * Число из поля ввода: пустое и мусор → 0.
 * Поля намеренно текстовые (не type=number): браузер отбрасывает запятую, а
 * «1,5 куб.м» — обычная для русского пользователя запись. Здесь же убираем
 * пробелы-разделители разрядов, которые появляются при копировании из Excel.
 */
function fieldNumber(input: HTMLInputElement | null): number {
  if (!input) return 0;
  const parsed = Number(input.value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Показывает/прячет подсказку об ошибке поля. */
function markField(field: HTMLElement, valid: boolean, form: HTMLElement): void {
  const name = field.getAttribute("name") ?? "";
  const error = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
  if (valid) {
    field.removeAttribute("aria-invalid");
    error?.classList.add("hidden");
  } else {
    field.setAttribute("aria-invalid", "true");
    error?.classList.remove("hidden");
  }
}

/** Инициализация калькулятора. Без разметки калькулятора ничего не делает. */
export function initCalculator(): void {
  const root = document.querySelector<HTMLElement>("[data-calculator]");
  if (!root) return;

  const paramsForm = root.querySelector<HTMLFormElement>("[data-calc-form]");
  const itemsBox = root.querySelector<HTMLElement>("[data-calc-items]");
  const itemTemplate = root.querySelector<HTMLTemplateElement>("[data-calc-item-template]");
  const requestForm = root.querySelector<HTMLFormElement>("[data-calc-request]");
  if (!paramsForm || !itemsBox || !itemTemplate || !requestForm) return;

  const addButton = root.querySelector<HTMLButtonElement>("[data-calc-add]");
  const summary = root.querySelector<HTMLElement>("[data-calc-summary]");
  const tableBody = root.querySelector<HTMLElement>("[data-calc-table]");

  // ── Ввод → данные калькулятора ──────────────────────────────────────────
  /** Собирает строки товаров в структуру расчёта. */
  function readItems(): CalcItemInput[] {
    return Array.from(itemsBox!.querySelectorAll<HTMLElement>("[data-calc-item]")).map(
      (row) => ({
        name: row.querySelector<HTMLInputElement>("[data-item-name]")?.value.trim() ?? "",
        priceCny: fieldNumber(row.querySelector<HTMLInputElement>("[data-item-price]")),
        dutyRate: fieldNumber(row.querySelector<HTMLInputElement>("[data-item-duty]")),
        vatRate: Number(
          row.querySelector<HTMLSelectElement>("[data-item-vat]")?.value ??
            CALC_CONFIG.vatRates[0].value,
        ),
      }),
    );
  }

  /** Текущее состояние формы параметров. */
  function readInput(): CalcInput {
    const method = paramsForm!.querySelector<HTMLInputElement>(
      "[data-calc-method]:checked",
    );
    return {
      city: paramsForm!.querySelector<HTMLSelectElement>("[data-calc-city]")?.value ?? "",
      methodId: method?.value ?? CALC_CONFIG.methods[0].id,
      weight: fieldNumber(paramsForm!.querySelector<HTMLInputElement>("[data-calc-weight]")),
      volume: fieldNumber(paramsForm!.querySelector<HTMLInputElement>("[data-calc-volume]")),
      items: readItems(),
    };
  }

  // ── Отрисовка результата ────────────────────────────────────────────────
  /** Пишет значение в ячейку итогов [data-calc-out="ключ"]. */
  function out(key: string, value: string): void {
    root!.querySelectorAll<HTMLElement>(`[data-calc-out="${key}"]`).forEach((node) => {
      node.textContent = value;
    });
  }

  /** Подставляет суммы пошлины и НДС в строки товаров (поля «только чтение»). */
  function fillItemSums(result: CalcResult): void {
    const rows = itemsBox!.querySelectorAll<HTMLElement>("[data-calc-item]");
    rows.forEach((row, index) => {
      const item = result.items[index];
      const duty = row.querySelector<HTMLInputElement>("[data-item-duty-sum]");
      const vat = row.querySelector<HTMLInputElement>("[data-item-vat-sum]");
      const known = Boolean(rates) && Boolean(item);
      if (duty) duty.value = known ? nfMoney.format(item.duty) : "—";
      if (vat) vat.value = known ? nfMoney.format(item.vat) : "—";
    });
  }

  /** Таблица-детализация по товарам (правая колонка). */
  function fillTable(result: CalcResult): void {
    if (!tableBody) return;
    tableBody.textContent = "";

    const rows: [string, string][] = [
      ["Город", result.city],
      ["Способ доставки", `${result.method.label} · ${result.method.time}`],
      ["Вес", `${nfVolume.format(result.weight)} кг`],
      ["Объём", `${nfVolume.format(result.volume)} куб.м`],
      [
        "Объём для тарификации",
        `${nfVolume.format(result.chargeableVolume)} куб.м · ${
          result.chargeableBy === "weight"
            ? `по весу (${CALC_CONFIG.weightPerCbm} кг/куб.м)`
            : "по объёму"
        }`,
      ],
      ["Стоимость доставки", usd(result.delivery)],
    ];

    result.items.forEach((item, index) => {
      const number = result.items.length > 1 ? ` ${index + 1}` : "";
      rows.push([`Наименование товара${number}`, item.name || "—"]);
      rows.push([
        `Стоимость товара${number}`,
        rates ? `${nfMoney.format(item.priceCny)} ¥ · ${usd(item.priceUsd)}` : "—",
      ]);
      rows.push([`Ставка пошлины${number}`, `${nfVolume.format(item.dutyRate)} %`]);
      rows.push([`Сумма пошлины${number}`, rates ? usd(item.duty) : "—"]);
      rows.push([`Ставка НДС${number}`, `${nfVolume.format(item.vatRate)} %`]);
      rows.push([`Сумма НДС${number}`, rates ? usd(item.vat) : "—"]);
    });

    rows.forEach(([label, value]) => {
      const tr = document.createElement("tr");
      tr.className = "border-b border-slate-200 last:border-b-0";

      const th = document.createElement("th");
      th.scope = "row";
      th.className = "py-2 pr-4 text-left align-top font-normal text-muted";
      th.textContent = label;

      const td = document.createElement("td");
      td.className = "py-2 text-right align-top font-medium text-ink";
      td.textContent = value;

      tr.append(th, td);
      tableBody.append(tr);
    });
  }

  /** Полный пересчёт и отрисовка. */
  function recalc(): void {
    const input = readInput();
    // Без курсов ЦБ считаем только доставку: таможня требует пересчёта валют.
    const result = computeCalculation(input, rates ?? { usd: 0, cny: 0, date: "" });

    const known = Boolean(rates);
    out("delivery", usd(result.delivery));
    out("chargeable", `${nfVolume.format(result.chargeableVolume)} куб.м`);
    out(
      "chargeableBy",
      result.chargeableBy === "weight"
        ? `тарифицируем по весу: ${nfVolume.format(result.weight)} кг ÷ ${
            CALC_CONFIG.weightPerCbm
          } кг/куб.м`
        : "тарифицируем по объёму груза",
    );
    out("tariff", `${result.method.rate} $/куб.м · ${result.method.time}`);
    out("duty", known ? usd(result.duty) : "—");
    out("vat", known ? usd(result.vat) : "—");
    out("deliveryAndCustoms", known ? usd(result.deliveryAndCustoms) : usd(result.delivery));
    out("deliveryAndCustomsRub", known ? rub(result.deliveryAndCustoms) : "");
    out("goods", known ? usd(result.goodsUsd) : "—");
    out("goodsRub", known ? rub(result.goodsUsd) : "");
    out("total", known ? usd(result.total) : "—");
    out("totalRub", known ? rub(result.total) : "");

    // Предупреждение о выходе за границы применимости расчёта.
    const overLimit = result.chargeableVolume > CALC_CONFIG.maxVolume;
    root!
      .querySelector<HTMLElement>("[data-calc-over-limit]")
      ?.classList.toggle("hidden", !overLimit);

    fillItemSums(result);
    fillTable(result);
  }

  // ── Строки товаров ──────────────────────────────────────────────────────
  /** Перенумеровывает заголовки строк («Товар 2») и прячет удаление у единственной. */
  function renumber(): void {
    const rows = itemsBox!.querySelectorAll<HTMLElement>("[data-calc-item]");
    rows.forEach((row, index) => {
      const caption = row.querySelector<HTMLElement>("[data-item-caption]");
      if (caption) caption.textContent = `Товар ${index + 1}`;
      // Утилита `hidden`, а не атрибут: у кнопки есть класс inline-flex, и он
      // перебил бы `display: none` из браузерного стиля для [hidden].
      const remove = row.querySelector<HTMLButtonElement>("[data-item-remove]");
      remove?.classList.toggle("hidden", rows.length < 2);
    });
    if (addButton) {
      addButton.disabled = rows.length >= CALC_CONFIG.limits.maxItems;
    }
  }

  /** Добавляет строку товара из шаблона. */
  function addItem(focus = true): void {
    const rows = itemsBox!.querySelectorAll("[data-calc-item]").length;
    if (rows >= CALC_CONFIG.limits.maxItems) return;

    itemSeq += 1;
    const fragment = itemTemplate!.content.cloneNode(true) as DocumentFragment;

    // Уникальные id полей: в шаблоне стоит плейсхолдер __ID__.
    fragment.querySelectorAll<HTMLElement>("[id]").forEach((node) => {
      node.id = node.id.replace("__ID__", String(itemSeq));
    });
    fragment.querySelectorAll<HTMLLabelElement>("label[for]").forEach((node) => {
      node.htmlFor = node.htmlFor.replace("__ID__", String(itemSeq));
    });

    itemsBox!.append(fragment);
    renumber();
    recalc();

    if (focus) {
      const last = itemsBox!.querySelector<HTMLElement>("[data-calc-item]:last-child");
      last?.querySelector<HTMLInputElement>("[data-item-name]")?.focus();
    }
  }

  addButton?.addEventListener("click", () => addItem());

  itemsBox.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-item-remove]",
    );
    if (!button) return;
    if (itemsBox.querySelectorAll("[data-calc-item]").length < 2) return;
    button.closest("[data-calc-item]")?.remove();
    renumber();
    recalc();
  });

  // Пересчёт на любой ввод: и в параметрах груза, и в строках товаров.
  ["input", "change"].forEach((type) => {
    paramsForm.addEventListener(type, recalc);
  });

  // Кнопка «Рассчитать» на мобильных прокручивает к итогам: на узком экране
  // результат уезжает под форму, и без прокрутки клик выглядит «пустым».
  paramsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    recalc();
    if (window.matchMedia("(max-width: 1023px)").matches) {
      summary?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // ── Курсы ЦБ ────────────────────────────────────────────────────────────
  /** Показывает курсы и статус их получения. */
  function renderRates(status: "ok" | "stale" | "error", date = ""): void {
    out("rateUsd", rates ? nfRate.format(rates.usd) : "—");
    out("rateCny", rates ? nfRate.format(rates.cny) : "—");
    out("ratesDate", date ? `на ${ruDate(date)}` : "");

    const stale = root!.querySelector<HTMLElement>("[data-rates-stale]");
    const failed = root!.querySelector<HTMLElement>("[data-rates-error]");
    stale?.classList.toggle("hidden", status !== "stale");
    failed?.classList.toggle("hidden", status !== "error");
  }

  /** Забирает курсы ЦБ с бэкенда (кэш на стороне сервера). */
  async function loadRates(): Promise<void> {
    const endpoint = document.documentElement.dataset.ratesEndpoint || "/api/rates";
    try {
      const response = await fetch(endpoint, { headers: { accept: "application/json" } });
      const data = (await response.json().catch(() => ({}))) as RatesResponse;

      if (!response.ok || data.ok !== true || !data.usd || !data.cny) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      rates = { usd: data.usd, cny: data.cny, date: data.date ?? "" };
      renderRates(data.stale ? "stale" : "ok", rates.date);
    } catch (error) {
      console.error("Не удалось получить курсы ЦБ:", error);
      renderRates("error");
    } finally {
      recalc();
    }
  }

  // ── Отправка заявки с расчётом ──────────────────────────────────────────
  const success = requestForm.querySelector<HTMLElement>("[data-form-success]");
  const failure = requestForm.querySelector<HTMLElement>("[data-form-error]");
  const consent = requestForm.querySelector<HTMLInputElement>("[data-consent]");
  const submitBtn = requestForm.querySelector<HTMLButtonElement>('button[type="submit"]');

  consent?.addEventListener("change", () => {
    if (consent.checked) markField(consent, true, requestForm);
  });

  requestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (requestForm.dataset.sending === "true") return;

    let valid = true;

    const contact = requestForm.querySelector<HTMLInputElement>('[data-validate="contact"]');
    if (contact) {
      const contactValid = isValidContact(contact.value);
      markField(contact, contactValid, requestForm);
      valid &&= contactValid;
    }

    if (consent) {
      markField(consent, consent.checked, requestForm);
      valid &&= consent.checked;
    }

    // Заявку без единой введённой стоимости отправлять можно (человеку нужен
    // расчёт от менеджера), а вот габариты груза нужны — без них расчёта нет.
    const input = readInput();
    const volumeField = paramsForm.querySelector<HTMLInputElement>("[data-calc-volume]");
    const weightField = paramsForm.querySelector<HTMLInputElement>("[data-calc-weight]");
    const sizeValid = input.volume > 0 || input.weight > 0;
    if (volumeField) markField(volumeField, sizeValid, paramsForm);
    if (weightField) markField(weightField, sizeValid, paramsForm);
    valid &&= sizeValid;

    if (!valid) {
      const firstInvalid = root.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus({ preventScroll: true });
      firstInvalid?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    failure?.classList.add("hidden");
    success?.classList.add("hidden");
    requestForm.dataset.sending = "true";

    const idleLabel = submitBtn?.textContent ?? "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent =
        document.documentElement.dataset.formSending || "Отправляем…";
    }

    void sendLead(requestForm, { form: "calculator", calc: input, calcRates: rates })
      .then(() => {
        trackEvent("lead_form_submit");
        trackEvent("calculator_submit");
        // Страница благодарности — отдельная (не контакты): адрес задаётся в
        // разметке, чтобы работали языковые версии.
        const thanks = requestForm.dataset.redirect;
        if (thanks) {
          window.location.assign(thanks);
          return;
        }
        success?.classList.remove("hidden");
      })
      .catch((error: unknown) => {
        console.error("Не удалось отправить заявку с калькулятора:", error);
        failure?.classList.remove("hidden");
      })
      .finally(() => {
        delete requestForm.dataset.sending;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = idleLabel;
        }
      });
  });

  // ── Старт ───────────────────────────────────────────────────────────────
  // Первая строка товара рендерится сервером (калькулятор виден и без JS),
  // поэтому счётчик id продолжает нумерацию с неё, а не начинает заново.
  itemSeq = itemsBox.querySelectorAll("[data-calc-item]").length;
  renumber();
  recalc();
  void loadRates();
}

/**
 * Груз после погрузки: упаковочный лист (места, нетто, брутто, объём) и спецификация для
 * перевозчика (инвойс + упаковочный лист, по позициям) — общий код сервера и интерфейса.
 */

export type PackingLine = {
  name: string;
  quantity: number | null;
  unit: string | null;
  /** Мест: рулонов, коробов, паллет. */
  packages: number | null;
  packageType: string | null;
  netKg: number | null;
  grossKg: number | null;
  volumeM3: number | null;
};

export type PackingTotals = { packages: number | null; netKg: number | null; grossKg: number | null; volumeM3: number | null };

/** Упаковочный лист — documents.data.packing. */
export type PackingData = { lines: PackingLine[]; totals: PackingTotals };

const sum = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? Math.round(xs.reduce<number>((s, x) => s + (x ?? 0), 0) * 1000) / 1000 : null);

export function packingTotals(lines: PackingLine[]): PackingTotals {
  return {
    packages: sum(lines.map((l) => l.packages)),
    netKg: sum(lines.map((l) => l.netKg)),
    grossKg: sum(lines.map((l) => l.grossKg)),
    volumeM3: sum(lines.map((l) => l.volumeM3)),
  };
}

export const emptyPackingLine = (): PackingLine => ({ name: "", quantity: null, unit: null, packages: null, packageType: null, netKg: null, grossKg: null, volumeM3: null });

/** Что спрашивает перевозчик и чего нет в документах — хранится в сделке (shipments.spec). */
export type SpecParams = {
  /** Получатель / Consignee — обычно СВХ или терминал с ИНН и адресом. */
  consignee: string;
  /** Станция / порт назначения. */
  station: string;
  country: string;
  /** Страна происхождения: «Китай / China». */
  origin: string;
  /** Описание товара по позиции (SpecLine.key; старые — по коду ТН ВЭД): «Искусственный газон / artificial grass». */
  descriptions: Record<string, string>;
};

export const DEFAULT_SPEC_PARAMS: SpecParams = { consignee: "", station: "", country: "Россия", origin: "Китай / China", descriptions: {} };

/** Строка спецификации — одна на позицию инвойса / упаковочного листа. */
export type SpecLine = {
  no: number;
  /** Ключ для описаний (SpecParams.descriptions) — нормализованное название позиции. */
  key: string;
  hsCode: string;
  origin: string;
  description: string;
  qty: number;
  packages: number | null;
  netKg: number | null;
  grossKg: number | null;
  price: number | null;
  amount: number;
};

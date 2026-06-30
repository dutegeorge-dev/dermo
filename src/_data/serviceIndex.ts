import uslugi from "./uslugi.js";

/**
 * Плоский индекс услуг: slug → { url, labelKey, icon }.
 * Собирается из единого источника структуры услуг (_data/uslugi.ts): способы
 * доставки, товарные категории, торговые услуги и доп. услуги.
 *
 * Используется для перелинковки статья/кейс → услуга: во front matter контента
 * поле `related_service` хранит slug услуги, а здесь по нему достаётся URL и
 * ключ названия (i18n) для блока «Закажите у нас». Если slug не найден — блок
 * не выводится (ссылок на несуществующее нет).
 */
export interface ServiceIndexEntry {
  url: string;
  labelKey: string;
  icon: string;
}

const serviceIndex: Record<string, ServiceIndexEntry> = {};

for (const group of [
  uslugi.methods,
  uslugi.tovary,
  uslugi.torgovlyaServices,
  uslugi.dopUslugi,
]) {
  for (const item of group) {
    // Первое вхождение слага выигрывает (товарные/торговые слаги уникальны).
    if (item.slug && !serviceIndex[item.slug]) {
      serviceIndex[item.slug] = {
        url: item.url,
        labelKey: item.nameKey,
        icon: item.icon,
      };
    }
  }
}

export default serviceIndex;

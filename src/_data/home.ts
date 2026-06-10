import type { HomeData } from "./types.js";

/**
 * Данные секций главной страницы (полоса доверия, шаги процесса, парные крылья).
 * Тексты не хардкодятся в разметке: здесь — ключи словаря (i18n) + иконки Lucide.
 * Меняется состав/порядок — отражается на главной без правок шаблонов.
 *
 * Плейсхолдеры кейсов и блога — в отдельных файлах homeCases.ts / homeBlog.ts.
 */
const home: HomeData = {
  // Полоса доверия: реальные проверяемые факты (см. ТЗ, раздел 3).
  trust: [
    { icon: "award", valueKey: "home.trust.expValue", labelKey: "home.trust.expLabel" },
    { icon: "map-pin", valueKey: "home.trust.teamValue", labelKey: "home.trust.teamLabel" },
    { icon: "package", valueKey: "home.trust.volumeValue", labelKey: "home.trust.volumeLabel" },
    { icon: "badge-check", valueKey: "home.trust.whiteValue", labelKey: "home.trust.whiteLabel" },
    { icon: "landmark", valueKey: "home.trust.bankValue", labelKey: "home.trust.bankLabel" },
  ],

  // Два равноправных крыла — сердце главной (торгово-логистическая суть).
  wings: {
    logistics: {
      icon: "truck",
      titleKey: "home.wings.logistics.title",
      descKey: "home.wings.logistics.desc",
      ctaKey: "home.wings.logistics.cta",
      url: "/logistika/",
      teaserKeys: [
        "home.wings.logistics.t1",
        "home.wings.logistics.t2",
        "home.wings.logistics.t3",
      ],
    },
    trade: {
      icon: "store",
      titleKey: "home.wings.trade.title",
      descKey: "home.wings.trade.desc",
      ctaKey: "home.wings.trade.cta",
      url: "/torgovlya/",
      teaserKeys: [
        "home.wings.trade.t1",
        "home.wings.trade.t2",
        "home.wings.trade.t3",
        "home.wings.trade.t4",
      ],
    },
  },

  // Процесс работы: 7 шагов (01–07). Текст шага 1 содержит ссылку на форму.
  steps: [
    { num: "01", icon: "clipboard-list", titleKey: "home.steps.s1.title", textKey: "home.steps.s1.text" },
    { num: "02", icon: "file-text", titleKey: "home.steps.s2.title", textKey: "home.steps.s2.text" },
    { num: "03", icon: "warehouse", titleKey: "home.steps.s3.title", textKey: "home.steps.s3.text" },
    { num: "04", icon: "badge-check", titleKey: "home.steps.s4.title", textKey: "home.steps.s4.text" },
    { num: "05", icon: "truck", titleKey: "home.steps.s5.title", textKey: "home.steps.s5.text" },
    { num: "06", icon: "shield-check", titleKey: "home.steps.s6.title", textKey: "home.steps.s6.text" },
    { num: "07", icon: "package-check", titleKey: "home.steps.s7.title", textKey: "home.steps.s7.text" },
  ],
};

export default home;

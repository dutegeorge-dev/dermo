import type { TorgovlyaData } from "./types.js";

/**
 * Структурные данные страницы «Торговля» (/torgovlya/).
 * Тексты не хардкодятся в разметке: здесь — иконки Lucide, номера шагов и ключи
 * словаря (i18n). Сами строки лежат в _data/i18n/*.ts под веткой `torgovlya`.
 * Меняется состав/порядок секций — отражается на странице без правок шаблона.
 */
const torgovlya: TorgovlyaData = {
  // Раздел 4 ТЗ: что нужно для прямой работы с заводом (4 пункта).
  directPoints: [
    { icon: "map-pin", titleKey: "torgovlya.direct.p1.title", textKey: "torgovlya.direct.p1.text" },
    { icon: "globe", titleKey: "torgovlya.direct.p2.title", textKey: "torgovlya.direct.p2.text" },
    { icon: "shield-check", titleKey: "torgovlya.direct.p3.title", textKey: "torgovlya.direct.p3.text" },
    { icon: "handshake", titleKey: "torgovlya.direct.p4.title", textKey: "torgovlya.direct.p4.text" },
  ],

  // Раздел 5 ТЗ: Гуанчжоу + выезды в провинции.
  provinces: [
    "torgovlya.guangzhou.prov1",
    "torgovlya.guangzhou.prov2",
    "torgovlya.guangzhou.prov3",
    "torgovlya.guangzhou.prov4",
  ],
  guangzhouBenefits: [
    "torgovlya.guangzhou.b1",
    "torgovlya.guangzhou.b2",
    "torgovlya.guangzhou.b3",
  ],

  // Объединённый блок услуг (правка 6): полный цикл + отдельные услуги одним
  // списком, каждая карточка — ссылка на свою страницу /uslugi/<slug>/.
  // «Сертификация» как этап полного цикла убрана (правка 4) и остаётся здесь
  // как самостоятельная услуга. Тексты переиспользуются из веток fullCycle/separate.
  services: [
    { icon: "search", titleKey: "torgovlya.fullCycle.s1.title", textKey: "torgovlya.fullCycle.s1.text", url: "/uslugi/torgovlya/poisk-postavshchika/" },
    { icon: "factory", titleKey: "torgovlya.fullCycle.s2.title", textKey: "torgovlya.fullCycle.s2.text", url: "/uslugi/torgovlya/audit-proizvodstva/" },
    { icon: "globe", titleKey: "torgovlya.fullCycle.s3.title", textKey: "torgovlya.fullCycle.s3.text", url: "/uslugi/torgovlya/peregovory/" },
    { icon: "shield-check", titleKey: "torgovlya.fullCycle.s4.title", textKey: "torgovlya.fullCycle.s4.text", url: "/uslugi/torgovlya/kontrol-proizvodstva/" },
    { icon: "package-check", titleKey: "torgovlya.separate.s2.title", textKey: "torgovlya.separate.s2.text", url: "/uslugi/torgovlya/inspekciya/" },
    { icon: "package", titleKey: "torgovlya.fullCycle.s5.title", textKey: "torgovlya.fullCycle.s5.text", url: "/uslugi/torgovlya/upakovka-markirovka/" },
    { icon: "landmark", titleKey: "torgovlya.separate.s1.title", textKey: "torgovlya.separate.s1.text", url: "/uslugi/torgovlya/vykup-tovara/" },
    { icon: "calculator", titleKey: "torgovlya.separate.s3.title", textKey: "torgovlya.separate.s3.text", url: "/uslugi/torgovlya/vozvrat-nds/" },
    { icon: "badge-check", titleKey: "torgovlya.separate.s5.title", textKey: "torgovlya.separate.s5.text", url: "/uslugi/torgovlya/proverka-zavoda/" },
  ],

  // Раздел 7 ТЗ: этапы работы (процесс закупки, 7 шагов 01–07).
  process: [
    { num: "01", icon: "clipboard-list", titleKey: "torgovlya.process.s1.title", textKey: "torgovlya.process.s1.text" },
    { num: "02", icon: "search", titleKey: "torgovlya.process.s2.title", textKey: "torgovlya.process.s2.text" },
    { num: "03", icon: "package", titleKey: "torgovlya.process.s3.title", textKey: "torgovlya.process.s3.text" },
    { num: "04", icon: "file-text", titleKey: "torgovlya.process.s4.title", textKey: "torgovlya.process.s4.text" },
    { num: "05", icon: "factory", titleKey: "torgovlya.process.s5.title", textKey: "torgovlya.process.s5.text" },
    { num: "06", icon: "badge-check", titleKey: "torgovlya.process.s6.title", textKey: "torgovlya.process.s6.text" },
    { num: "07", icon: "truck", titleKey: "torgovlya.process.s7.title", textKey: "torgovlya.process.s7.text" },
  ],

  // Раздел 10 ТЗ: направления — горизонтальные карточки с фото.
  // Сторона фото чередуется (слева / справа / слева). Тексты — короткие
  // (заголовок + бейдж + строка сути + 3 буллета + ссылка).
  specDirections: [
    {
      photoIcon: "package",
      photoRight: false,
      titleKey: "torgovlya.spec.flooring.title",
      badgeKey: "torgovlya.spec.flooring.badge",
      leadKey: "torgovlya.spec.flooring.lead",
      bulletKeys: [
        "torgovlya.spec.flooring.b1",
        "torgovlya.spec.flooring.b2",
        "torgovlya.spec.flooring.b3",
      ],
      linkKey: "torgovlya.spec.flooring.link",
      url: "/uslugi/dostavka/tovary/napolnye-pokrytiya/",
    },
    {
      photoIcon: "truck",
      photoRight: true,
      titleKey: "torgovlya.spec.parts.title",
      badgeKey: "torgovlya.spec.parts.badge",
      leadKey: "torgovlya.spec.parts.lead",
      bulletKeys: [
        "torgovlya.spec.parts.b1",
        "torgovlya.spec.parts.b2",
        "torgovlya.spec.parts.b3",
      ],
      linkKey: "torgovlya.spec.parts.link",
      url: "/uslugi/dostavka/tovary/zapchasti/",
    },
    {
      photoIcon: "factory",
      photoRight: false,
      titleKey: "torgovlya.spec.machines.title",
      badgeKey: "torgovlya.spec.machines.badge",
      leadKey: "torgovlya.spec.machines.lead",
      bulletKeys: [
        "torgovlya.spec.machines.b1",
        "torgovlya.spec.machines.b2",
        "torgovlya.spec.machines.b3",
      ],
      linkKey: "torgovlya.spec.machines.link",
      url: "/uslugi/dostavka/tovary/oborudovanie/",
    },
  ],

  // Раздел 14 ТЗ: FAQ (8 вопросов, микроразметка FAQPage).
  faq: [
    { questionKey: "torgovlya.faq.q1.q", answerKey: "torgovlya.faq.q1.a" },
    { questionKey: "torgovlya.faq.q2.q", answerKey: "torgovlya.faq.q2.a" },
    { questionKey: "torgovlya.faq.q3.q", answerKey: "torgovlya.faq.q3.a" },
    { questionKey: "torgovlya.faq.q4.q", answerKey: "torgovlya.faq.q4.a" },
    { questionKey: "torgovlya.faq.q5.q", answerKey: "torgovlya.faq.q5.a" },
    { questionKey: "torgovlya.faq.q6.q", answerKey: "torgovlya.faq.q6.a" },
    { questionKey: "torgovlya.faq.q7.q", answerKey: "torgovlya.faq.q7.a" },
    { questionKey: "torgovlya.faq.q8.q", answerKey: "torgovlya.faq.q8.a" },
  ],
};

export default torgovlya;

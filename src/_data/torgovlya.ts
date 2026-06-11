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
    { icon: "search", titleKey: "torgovlya.fullCycle.s1.title", textKey: "torgovlya.fullCycle.s1.text", url: "/uslugi/poisk-postavshchika/" },
    { icon: "factory", titleKey: "torgovlya.fullCycle.s2.title", textKey: "torgovlya.fullCycle.s2.text", url: "/uslugi/audit-proizvodstva/" },
    { icon: "globe", titleKey: "torgovlya.fullCycle.s3.title", textKey: "torgovlya.fullCycle.s3.text", url: "/uslugi/peregovory/" },
    { icon: "shield-check", titleKey: "torgovlya.fullCycle.s4.title", textKey: "torgovlya.fullCycle.s4.text", url: "/uslugi/kontrol-proizvodstva/" },
    { icon: "package-check", titleKey: "torgovlya.separate.s2.title", textKey: "torgovlya.separate.s2.text", url: "/uslugi/inspekciya/" },
    { icon: "package", titleKey: "torgovlya.fullCycle.s5.title", textKey: "torgovlya.fullCycle.s5.text", url: "/uslugi/upakovka-markirovka/" },
    { icon: "landmark", titleKey: "torgovlya.separate.s1.title", textKey: "torgovlya.separate.s1.text", url: "/uslugi/vykup-tovara/" },
    { icon: "calculator", titleKey: "torgovlya.separate.s3.title", textKey: "torgovlya.separate.s3.text", url: "/uslugi/vozvrat-nds/" },
    { icon: "badge-check", titleKey: "torgovlya.separate.s5.title", textKey: "torgovlya.separate.s5.text", url: "/uslugi/proverka-zavoda/" },
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

  // Раздел 10 ТЗ: специализация — направления.
  flooringPoints: [
    { titleKey: "torgovlya.spec.flooring.pt1.title", textKey: "torgovlya.spec.flooring.pt1.text" },
    { titleKey: "torgovlya.spec.flooring.pt2.title", textKey: "torgovlya.spec.flooring.pt2.text" },
    { titleKey: "torgovlya.spec.flooring.pt3.title", textKey: "torgovlya.spec.flooring.pt3.text" },
  ],
  partsBrands: [
    "torgovlya.spec.parts.brand1",
    "torgovlya.spec.parts.brand2",
    "torgovlya.spec.parts.brand3",
    "torgovlya.spec.parts.brand4",
    "torgovlya.spec.parts.brand5",
    "torgovlya.spec.parts.brand6",
  ],
  partsSupply: [
    "torgovlya.spec.parts.supply1",
    "torgovlya.spec.parts.supply2",
    "torgovlya.spec.parts.supply3",
    "torgovlya.spec.parts.supply4",
  ],
  partsAdvantages: [
    "torgovlya.spec.parts.adv1",
    "torgovlya.spec.parts.adv2",
    "torgovlya.spec.parts.adv3",
  ],
  machineTypes: [
    "torgovlya.spec.machines.type1",
    "torgovlya.spec.machines.type2",
    "torgovlya.spec.machines.type3",
    "torgovlya.spec.machines.type4",
  ],
  machineHow: [
    "torgovlya.spec.machines.how1",
    "torgovlya.spec.machines.how2",
    "torgovlya.spec.machines.how3",
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

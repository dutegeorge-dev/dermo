import type { MainNavItem } from "./types.js";

/**
 * Основная навигация (ярус 2 хедера).
 * «Блог» временно скрыт — строка ниже закомментирована, вернуть = раскомментировать.
 * «О компании» (/o-kompanii/) намеренно не в списке: страница осталась доступной
 * по прямой ссылке, но нигде на сайте на неё не ссылаемся.
 * Подписи берутся из словаря по `titleKey` (без хардкода текста в шаблоне).
 * Единственный пункт с раскрытием — «Услуги» (mega: true), у него нет
 * собственной ссылки: на десктопе он раскрывает мега-меню, на мобиле — аккордеон.
 */
const navigation: MainNavItem[] = [
  { titleKey: "nav.services", mega: true },
  { titleKey: "nav.cases", url: "/kejsy/" },
  // { titleKey: "nav.blog", url: "/blog/" },
  { titleKey: "nav.contacts", url: "/kontakty/" },
];

export default navigation;

/** Реквизиты своей компании (настройка «company»). */

export type BankAccount = {
  id: string;
  /** Подпись в интерфейсе: «Юани, ВТБ». */
  label: string;
  currency: string;
  account: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  bankInn: string;
  bankAddress: string;
};

export type CompanySettings = {
  name: string;
  fullName: string;
  legalAddress: string;
  ogrn: string;
  inn: string;
  kpp: string;
  okpo: string;
  city: string;
  signatoryTitle: string;
  signatoryName: string;
  /** «Фотин Е.П.» — под подписью. */
  signatoryShort: string;
  signatoryBasis: string;
  email: string;
  phone: string;
  accounts: BankAccount[];
  /** Какой счёт ставить в поручения (договор комиссии). */
  orderAccountId: string | null;
};

export const EMPTY_COMPANY: CompanySettings = {
  name: "",
  fullName: "",
  legalAddress: "",
  ogrn: "",
  inn: "",
  kpp: "",
  okpo: "",
  city: "",
  signatoryTitle: "Директор",
  signatoryName: "",
  signatoryShort: "",
  signatoryBasis: "Устава",
  email: "",
  phone: "",
  accounts: [],
  orderAccountId: null,
};

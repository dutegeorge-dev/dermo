import { Link } from "react-router";

import { Content } from "../components/Layout.tsx";
import { EmptyState } from "../components/ui.tsx";

/** Заглушка раздела CRM (этап 2). */
export function DealsPage() {
  return (
    <Content>
      <EmptyState title="Сделки — скоро">
        Канбан-доска сделок BARS-… с клиентами, сроками и исполнителями появится на следующем этапе.
      </EmptyState>
    </Content>
  );
}

export function NotFoundPage() {
  return (
    <Content>
      <EmptyState title="Страница не найдена">
        <Link to="/" className="link">На главную раздела</Link>
      </EmptyState>
    </Content>
  );
}

import { Link } from "react-router";

import { Content } from "../components/Layout.tsx";
import { EmptyState } from "../components/ui.tsx";

export function NotFoundPage() {
  return (
    <Content>
      <EmptyState title="Страница не найдена">
        <Link to="/" className="link">На главную раздела</Link>
      </EmptyState>
    </Content>
  );
}

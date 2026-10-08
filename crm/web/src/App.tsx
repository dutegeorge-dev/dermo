import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router";

import { Layout } from "./components/Layout.tsx";
import { Spinner } from "./components/ui.tsx";
import { BASE } from "./lib/api.ts";
import { useAuth } from "./lib/auth.tsx";
import { AuditPage } from "./pages/AuditPage.tsx";
import { CallScriptHistory } from "./pages/CallScriptHistory.tsx";
import { CallScriptPage } from "./pages/CallScriptPage.tsx";
import { KbHome } from "./pages/kb/KbHome.tsx";
import { PageEdit } from "./pages/kb/PageEdit.tsx";
import { PageHistory } from "./pages/kb/PageHistory.tsx";
import { PageView } from "./pages/kb/PageView.tsx";
import { SpaceHome } from "./pages/kb/SpaceHome.tsx";
import { SpaceLayout } from "./pages/kb/SpaceLayout.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { CounterpartiesPage, CounterpartyPage } from "./pages/crm/CounterpartiesPage.tsx";
import { ProductPage, ProductsPage } from "./pages/crm/ProductsPage.tsx";
import { DocumentEditor } from "./pages/docs/DocumentEditor.tsx";
import { DocumentPage } from "./pages/docs/DocumentPage.tsx";
import { DocumentsPage } from "./pages/docs/DocumentsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { DealsPage } from "./pages/crm/DealsPage.tsx";
import { NotFoundPage } from "./pages/misc.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";

/** Без входа на любом адресе — только форма входа. */
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!user) return <LoginPage />;
  return <Outlet />;
}

function AdminOnly() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}

const router = createBrowserRouter(
  [
    {
      element: <RequireAuth />,
      children: [
        {
          element: <Layout />,
          children: [
            { index: true, element: <Navigate to="/kb" replace /> },
            { path: "kb", element: <KbHome /> },
            {
              path: "kb/:spaceKey",
              element: <SpaceLayout />,
              children: [
                { index: true, element: <SpaceHome /> },
                { path: ":pageId", element: <PageView /> },
                { path: ":pageId/edit", element: <PageEdit /> },
                { path: ":pageId/history", element: <PageHistory /> },
              ],
            },
            { path: "calls", element: <CallScriptPage /> },
            { path: "calls/history", element: <CallScriptHistory /> },
            { path: "deals", element: <DealsPage />, children: [{ path: ":key" }] },
            { path: "clients", element: <CounterpartiesPage key="client" role="client" /> },
            { path: "clients/:id", element: <CounterpartyPage key="client" role="client" /> },
            { path: "suppliers", element: <CounterpartiesPage key="supplier" role="supplier" /> },
            { path: "suppliers/:id", element: <CounterpartyPage key="supplier" role="supplier" /> },
            { path: "contractors", element: <CounterpartiesPage key="contractor" role="contractor" /> },
            { path: "contractors/:id", element: <CounterpartyPage key="contractor" role="contractor" /> },
            { path: "documents", element: <DocumentsPage /> },
            { path: "documents/new", element: <DocumentEditor key="new" /> },
            { path: "documents/:id", element: <DocumentPage /> },
            { path: "documents/:id/edit", element: <DocumentEditor key="edit" /> },
            { path: "products", element: <ProductsPage /> },
            { path: "products/:id", element: <ProductPage /> },
            { path: "profile", element: <ProfilePage /> },
            {
              element: <AdminOnly />,
              children: [
                { path: "users", element: <UsersPage /> },
                { path: "audit", element: <AuditPage /> },
                { path: "settings", element: <SettingsPage /> },
              ],
            },
            { path: "*", element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ],
  { basename: BASE },
);

export function App() {
  return <RouterProvider router={router} />;
}

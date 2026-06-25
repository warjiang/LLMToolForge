import { useEffect } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n/config";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { SkillsPage } from "@/pages/skills/SkillsPage";
import { McpPage } from "@/pages/mcp/McpPage";
import { ProvidersPage } from "@/pages/providers/ProvidersPage";
import { UnifiedApiPage } from "@/pages/unified/UnifiedApiPage";
import { ToolsPage } from "@/pages/tools/ToolsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useLocaleStore } from "@/store/locale";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "api-keys", element: <Navigate to="/providers" replace /> },
      { path: "providers", element: <ProvidersPage /> },
      {
        path: "providers/volcengine",
        element: <Navigate to="/providers" replace />,
      },
      { path: "playground", element: <Navigate to="/" replace /> },
      { path: "unified", element: <UnifiedApiPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "mcp", element: <McpPage /> },
      { path: "tools", element: <ToolsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

export default function App() {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    setLanguage(i18n.language as 'zh' | 'en');
  }, [setLanguage]);

  return (
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  );
}

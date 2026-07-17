import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n/config";
import { AppLayout } from "@/components/layout/AppLayout";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { useLocaleStore } from "@/store/locale";
import { useDeviceConfigStore } from "@/store/deviceConfig";
import { AGENT_ROUTE_PATH } from "@/lib/routes";

const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage }))
);
const SkillsPage = lazy(() =>
  import("@/pages/skills/SkillsPage").then((m) => ({ default: m.SkillsPage }))
);
const McpPage = lazy(() =>
  import("@/pages/mcp/McpPage").then((m) => ({ default: m.McpPage }))
);
const ConnectorsPage = lazy(() =>
  import("@/pages/connectors/ConnectorsPage").then((m) => ({
    default: m.ConnectorsPage,
  }))
);
const SshPage = lazy(() =>
  import("@/pages/ssh/SshPage").then((m) => ({ default: m.SshPage }))
);
const ProvidersPage = lazy(() =>
  import("@/pages/providers/ProvidersPage").then((m) => ({ default: m.ProvidersPage }))
);
const UnifiedApiPage = lazy(() =>
  import("@/pages/unified/UnifiedApiPage").then((m) => ({ default: m.UnifiedApiPage }))
);
const ToolsPage = lazy(() =>
  import("@/pages/tools/ToolsPage").then((m) => ({ default: m.ToolsPage }))
);
const BrowserPage = lazy(() =>
  import("@/pages/browser/BrowserPage").then((m) => ({ default: m.BrowserPage }))
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);

function PageFallback() {
  return (
    <div className="flex min-h-[320px] items-center justify-center text-label-13 text-muted-foreground">
      Loading...
    </div>
  );
}

function page(element: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: page(<DashboardPage />) },
      { path: "api-keys", element: <Navigate to="/providers" replace /> },
      { path: "providers", element: page(<ProvidersPage />) },
      {
        path: "providers/volcengine",
        element: <Navigate to="/providers" replace />,
      },
      { path: AGENT_ROUTE_PATH, element: page(<DashboardPage />) },
      { path: "unified", element: page(<UnifiedApiPage />) },
      { path: "skills", element: page(<SkillsPage />) },
      { path: "mcp", element: page(<McpPage />) },
      { path: "connectors", element: page(<ConnectorsPage />) },
      { path: "ssh", element: page(<SshPage />) },
      { path: "tools", element: page(<ToolsPage />) },
      { path: "browser", element: page(<BrowserPage />) },
      { path: "settings", element: page(<SettingsPage />) },
    ],
  },
]);

export default function App() {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const initDeviceConfig = useDeviceConfigStore((s) => s.init);

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    void initDeviceConfig();
  }, [initDeviceConfig]);

  useEffect(() => {
    setLanguage(i18n.language as 'zh' | 'en');
  }, [setLanguage]);

  return (
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </I18nextProvider>
  );
}

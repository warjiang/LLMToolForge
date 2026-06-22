import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { ApiKeysPage } from "@/pages/api-keys/ApiKeysPage";
import { SkillsPage } from "@/pages/skills/SkillsPage";
import { McpPage } from "@/pages/mcp/McpPage";
import { VolcenginePage } from "@/pages/providers/VolcenginePage";
import { PlaygroundPage } from "@/pages/playground/PlaygroundPage";
import { ToolsPage } from "@/pages/tools/ToolsPage";
import { SettingsPage } from "@/pages/SettingsPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "api-keys", element: <ApiKeysPage /> },
      { path: "providers/volcengine", element: <VolcenginePage /> },
      { path: "playground", element: <PlaygroundPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "mcp", element: <McpPage /> },
      { path: "tools", element: <ToolsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

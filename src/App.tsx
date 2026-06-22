import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { SkillsPage } from "@/pages/skills/SkillsPage";
import { McpPage } from "@/pages/mcp/McpPage";
import { ProvidersPage } from "@/pages/providers/ProvidersPage";
import { PlaygroundPage } from "@/pages/playground/PlaygroundPage";
import { ToolsPage } from "@/pages/tools/ToolsPage";
import { SettingsPage } from "@/pages/SettingsPage";

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

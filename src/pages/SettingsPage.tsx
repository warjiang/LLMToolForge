import { Monitor, Moon, Sun } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useThemeStore, type Theme } from "@/store/theme";

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
];

export function SettingsPage() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div>
      <PageHeader title="设置" description="应用外观与数据存储信息。" />

      <Card className="p-6">
        <h3 className="text-heading-16">外观</h3>
        <p className="mt-1 text-copy-14 text-muted-foreground">
          选择应用的主题。
        </p>
        <div className="mt-4 flex gap-2">
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "primary" : "secondary"}
              onClick={() => setTheme(value)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="mt-6 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Monitor className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-heading-16">数据存储</h3>
            <p className="mt-1 text-copy-14 text-muted-foreground">
              当前为本地模式，所有 API Key、Skill 与 MCP 配置都保存在本机。
              后续版本将支持加密存储与云端同步。
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

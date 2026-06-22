import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/store/theme";

export function Topbar({ title }: { title: string }) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <h1 className="text-heading-16">{title}</h1>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon-sm"
          onClick={toggle}
          aria-label="切换主题"
          title={theme === "dark" ? "切换到亮色" : "切换到暗色"}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
      </div>
    </header>
  );
}

import { Braces, Code2, Link2, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTool } from "./UrlTool";
import { JsonTool } from "./JsonTool";
import { EscapeTool } from "./EscapeTool";
import { UnicodeTool } from "./UnicodeTool";

export function ToolsPage() {
  const { t } = useTranslation("pages");

  const tabs = [
    { value: "url", label: t("url_codec"), icon: Link2, Comp: UrlTool },
    { value: "json", label: t("json_viewer"), icon: Braces, Comp: JsonTool },
    { value: "escape", label: t("escape_tool"), icon: Code2, Comp: EscapeTool },
    { value: "unicode", label: t("unicode_tool"), icon: Type, Comp: UnicodeTool },
  ];

  return (
    <div>
      <PageHeader
        title={t("tools_title")}
        description={t("tools_description")}
      />

      <Tabs defaultValue="url">
        <TabsList>
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map(({ value, Comp }) => (
          <TabsContent key={value} value={value}>
            <Card className="p-5">
              <Comp />
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

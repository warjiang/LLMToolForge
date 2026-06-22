import { Braces, Code2, Link2, Type } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTool } from "./UrlTool";
import { JsonTool } from "./JsonTool";
import { EscapeTool } from "./EscapeTool";
import { UnicodeTool } from "./UnicodeTool";

const tabs = [
  { value: "url", label: "URL 编解码", icon: Link2, Comp: UrlTool },
  { value: "json", label: "JSON 预览", icon: Braces, Comp: JsonTool },
  { value: "escape", label: "转义/去转义", icon: Code2, Comp: EscapeTool },
  { value: "unicode", label: "Unicode", icon: Type, Comp: UnicodeTool },
];

export function ToolsPage() {
  return (
    <div>
      <PageHeader
        title="实用工具"
        description="常用的编解码与文本处理工具，所有计算都在本地完成。"
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

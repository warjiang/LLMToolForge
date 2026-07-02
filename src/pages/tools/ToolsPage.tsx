import {
  Braces,
  Code2,
  FileText,
  Hash,
  KeyRound,
  Languages,
  Link2,
  NotebookText,
  Type,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTool } from "./UrlTool";
import { JsonTool } from "./JsonTool";
import { EscapeTool } from "./EscapeTool";
import { UnicodeTool } from "./UnicodeTool";
import { Base64Tool } from "./Base64Tool";
import { HashTool } from "./HashTool";
import { MarkdownTool } from "./MarkdownTool";
import { TranslateTool } from "./TranslateTool";
import { TextEditorTool } from "./TextEditorTool";

export function ToolsPage() {
  const { t } = useTranslation("pages");

  const tabs = [
    { value: "url", label: t("url_codec"), icon: Link2, Comp: UrlTool },
    { value: "json", label: t("json_viewer"), icon: Braces, Comp: JsonTool },
    { value: "base64", label: t("base64_tool"), icon: KeyRound, Comp: Base64Tool },
    { value: "hash", label: t("hash_tool"), icon: Hash, Comp: HashTool },
    { value: "escape", label: t("escape_tool"), icon: Code2, Comp: EscapeTool },
    { value: "unicode", label: t("unicode_tool"), icon: Type, Comp: UnicodeTool },
    { value: "markdown", label: t("markdown_tool"), icon: FileText, Comp: MarkdownTool },
    { value: "translate", label: t("translate_tool"), icon: Languages, Comp: TranslateTool },
    { value: "text-editor", label: t("text_editor_tool"), icon: NotebookText, Comp: TextEditorTool },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={t("tools_title")}
        description={t("tools_description")}
      />

      <Tabs defaultValue="url" className="flex flex-col flex-1 overflow-hidden">
        <TabsList>
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-hidden">
          {tabs.map(({ value, Comp }) => (
            <TabsContent key={value} value={value} className="h-full overflow-hidden">
              <div className="h-full overflow-hidden">
                <Comp />
              </div>
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}

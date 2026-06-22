import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolPanel } from "./ToolPanel";
import { jsonPreview } from "@/lib/tools";

const SAMPLE =
  '{"name":"demo","payload":"{\\"nested\\":\\"{\\\\\\"deep\\\\\\":true}\\",\\"count\\":3}","tags":"[\\"a\\",\\"b\\"]"}';

export function JsonTool() {
  const [input, setInput] = useState("");
  const [deep, setDeep] = useState(true);
  const [indent, setIndent] = useState(2);

  const result = useMemo(
    () => jsonPreview(input, { deep, indent }),
    [input, deep, indent]
  );

  return (
    <ToolPanel
      input={input}
      onInputChange={setInput}
      output={result.ok ? result.value : ""}
      error={result.ok ? null : result.error}
      inputLabel="JSON 输入"
      outputLabel="美化结果"
      inputPlaceholder='粘贴 JSON，支持被转义 / 双重编码的嵌套字段，如 {"data":"{\"a\":1}"}'
      actions={
        <Button variant="secondary" size="sm" onClick={() => setInput(SAMPLE)}>
          填充示例
        </Button>
      }
      options={
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="json-deep" checked={deep} onCheckedChange={setDeep} />
            <Label htmlFor="json-deep" className="cursor-pointer font-normal">
              递归解开嵌套/转义字段
            </Label>
          </div>
          <SegmentedControl
            size="sm"
            aria-label="缩进空格"
            value={String(indent)}
            onChange={(v) => setIndent(Number(v))}
            options={[
              { value: "2", label: "2 空格" },
              { value: "4", label: "4 空格" },
            ]}
          />
        </div>
      }
    />
  );
}

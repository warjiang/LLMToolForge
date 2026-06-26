import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolPanel } from "./ToolPanel";
import { hashHex, type HashAlgo } from "@/lib/tools";

const ALGOS: HashAlgo[] = ["md5", "sha-1", "sha-256", "sha-512"];

export function HashTool() {
  const { t } = useTranslation("pages");
  const [input, setInput] = useState("");
  const [algo, setAlgo] = useState<HashAlgo>("md5");
  const [upper, setUpper] = useState(false);
  const [short, setShort] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!input) {
      setOutput("");
      setError(null);
      return;
    }
    void hashHex(input, algo).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setOutput("");
        return;
      }
      let value = res.value;
      if (algo === "md5" && short) value = value.slice(8, 24);
      if (upper) value = value.toUpperCase();
      setOutput(value);
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [input, algo, upper, short]);

  return (
    <ToolPanel
      input={input}
      onInputChange={setInput}
      output={output}
      error={error}
      inputPlaceholder={t("tool_hash_placeholder")}
      actions={
        <SegmentedControl
          size="sm"
          aria-label={t("tool_hash_algo")}
          value={algo}
          onChange={setAlgo}
          options={ALGOS.map((a) => ({
            value: a,
            label: a === "md5" ? "MD5" : a.toUpperCase(),
          }))}
        />
      }
      options={
        <div className="flex flex-wrap items-center gap-4">
          {algo === "md5" && (
            <div className="flex items-center gap-2">
              <Switch id="hash-short" checked={short} onCheckedChange={setShort} />
              <Label htmlFor="hash-short" className="cursor-pointer font-normal">
                {t("tool_hash_16bit")}
              </Label>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch id="hash-upper" checked={upper} onCheckedChange={setUpper} />
            <Label htmlFor="hash-upper" className="cursor-pointer font-normal">
              {t("tool_hash_uppercase")}
            </Label>
          </div>
        </div>
      }
    />
  );
}

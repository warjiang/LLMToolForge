import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";

const shellLanguage = StreamLanguage.define(shell);

export function ShellCellEditor({
  value,
  disabled,
  onChange,
  onRun,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onRun: (keepFocus: boolean) => void;
}) {
  return (
    <CodeMirror
      value={value}
      height="auto"
      minHeight="112px"
      extensions={[shellLanguage]}
      basicSetup={{
        lineNumbers: true,
        bracketMatching: true,
        foldGutter: false,
        highlightActiveLine: false,
      }}
      editable={!disabled}
      onChange={onChange}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || (!event.shiftKey && !(event.metaKey || event.ctrlKey))) {
          return;
        }
        event.preventDefault();
        onRun(event.metaKey || event.ctrlKey);
      }}
      className="overflow-hidden rounded-sm border border-input bg-background text-copy-13 [&_.cm-editor]:outline-none [&_.cm-gutters]:border-r [&_.cm-gutters]:border-border [&_.cm-gutters]:bg-secondary/30 [&_.cm-scroller]:font-mono"
    />
  );
}

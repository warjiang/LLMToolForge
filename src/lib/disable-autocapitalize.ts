// WebView (WKWebView on macOS/iOS) enables autocapitalize/autocorrect on text
// fields by default, which capitalizes the first letter and "corrects" input in
// technical fields (tokens, URLs, IDs, code). Our own <Input>/<Textarea>
// components opt out explicitly, but raw <input>/<textarea> elements scattered
// across the app do not. This installs a single, cheap document-level fallback
// that runs only when a text field gains focus and only when the field has not
// opted in to capitalization itself.

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "email",
  "tel",
  "password",
  "",
]);

function shouldPatch(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(el.getAttribute("type")?.toLowerCase() ?? "");
  }
  return false;
}

function patch(el: HTMLInputElement | HTMLTextAreaElement) {
  // Respect an explicit opt-in from the element itself.
  if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "none");
  if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "off");
  if (!el.hasAttribute("spellcheck")) el.spellcheck = false;
}

let installed = false;

export function installAutocapitalizeGuard() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "focusin",
    (e) => {
      const target = e.target as Element | null;
      if (target && shouldPatch(target)) patch(target);
    },
    true
  );
}

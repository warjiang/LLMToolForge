import type { SkillRequirements } from "@/types";

export interface BinStatus {
  name: string;
  found: boolean;
  path?: string;
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * Check whether the executables a skill declares in `metadata.requires.bins`
 * are present on the user's PATH. Returns an empty list outside Tauri or when
 * there are no requirements, so callers can render unconditionally.
 */
export async function checkSkillBins(
  requires?: SkillRequirements
): Promise<BinStatus[]> {
  const bins = requires?.bins ?? [];
  if (bins.length === 0 || !isTauriRuntime()) {
    return bins.map((name) => ({ name, found: false }));
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BinStatus[]>("check_skill_bins", { bins });
}

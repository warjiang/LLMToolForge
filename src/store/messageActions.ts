import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * User preferences for the per-message action bar shown on hover: whether to
 * display the timestamp, whether copy is offered, and whether the mutating
 * actions (edit / delete / retry) are offered. All default to on to preserve
 * the previous behaviour.
 */
interface MessageActionsStore {
  showTimestamp: boolean;
  allowCopy: boolean;
  allowModify: boolean;
  setShowTimestamp: (value: boolean) => void;
  setAllowCopy: (value: boolean) => void;
  setAllowModify: (value: boolean) => void;
}

export const useMessageActionsStore = create<MessageActionsStore>()(
  persist(
    (set) => ({
      showTimestamp: true,
      allowCopy: true,
      allowModify: true,
      setShowTimestamp: (showTimestamp) => set({ showTimestamp }),
      setAllowCopy: (allowCopy) => set({ allowCopy }),
      setAllowModify: (allowModify) => set({ allowModify }),
    }),
    {
      name: "llmtoolforge.agent.message-actions",
    }
  )
);

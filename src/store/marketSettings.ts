import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Lightweight settings for the skill market: an optional GitHub token used to
 * raise the unauthenticated rate limit (60 req/h) when browsing or installing
 * skills from GitHub.
 */
interface MarketSettingsStore {
  githubToken: string;
  setGithubToken: (token: string) => void;
}

export const useMarketSettingsStore = create<MarketSettingsStore>()(
  persist(
    (set) => ({
      githubToken: "",
      setGithubToken: (githubToken) => set({ githubToken }),
    }),
    {
      name: "skill-market-settings",
      partialize: (state) => ({ githubToken: state.githubToken }),
    }
  )
);

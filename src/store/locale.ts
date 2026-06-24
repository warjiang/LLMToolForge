import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'zh' | 'en';

interface LocaleStore {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set) => ({
      language: 'zh',
      setLanguage: (lang) => {
        set({ language: lang });
      },
    }),
    {
      name: 'locale-storage',
      partialize: (state) => ({ language: state.language }),
    }
  )
);

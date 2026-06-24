import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enNavigation from './locales/en/navigation.json';
import enDashboard from './locales/en/dashboard.json';
import enPages from './locales/en/pages.json';
import enErrors from './locales/en/errors.json';

import zhCommon from './locales/zh/common.json';
import zhNavigation from './locales/zh/navigation.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhPages from './locales/zh/pages.json';
import zhErrors from './locales/zh/errors.json';

const resources = {
  en: {
    common: enCommon,
    navigation: enNavigation,
    dashboard: enDashboard,
    pages: enPages,
    errors: enErrors,
  },
  zh: {
    common: zhCommon,
    navigation: zhNavigation,
    dashboard: zhDashboard,
    pages: zhPages,
    errors: zhErrors,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh',
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;

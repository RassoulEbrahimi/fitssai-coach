import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../messages/en.json';
import fa from '../messages/fa.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: en
      },
      fa: {
        translation: fa
      }
    },
    lng: localStorage.getItem('language') || 'fa',
    fallbackLng: 'fa',
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

export default i18n;
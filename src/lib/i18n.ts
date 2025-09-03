import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
// DE-only mode: English and Persian files kept for future re-enable but not imported
// import en from '../messages/en.json';
// import fa from '../messages/fa.json';
import de from '../messages/de.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      // DE-only mode: Only German resources loaded
      de: {
        translation: de
      }
    },
    lng: 'de', // Force German
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

export default i18n;
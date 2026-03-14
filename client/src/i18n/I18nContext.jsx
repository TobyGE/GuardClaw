import { createContext, useContext, useState, useCallback } from 'react';
import en from './en.json';
import zh from './zh.json';

const translations = { en, zh };

const I18nContext = createContext();

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    return localStorage.getItem('guardclaw-lang') || 'en';
  });

  const setLanguage = useCallback((lang) => {
    setLanguageState(lang);
    localStorage.setItem('guardclaw-lang', lang);
  }, []);

  const t = useCallback((key, vars) => {
    let value = getNestedValue(translations[language], key);
    if (value === undefined) {
      // Fallback to English
      value = getNestedValue(translations.en, key);
    }
    if (value === undefined) {
      return key; // Return key as last resort
    }
    if (vars && typeof value === 'string') {
      Object.entries(vars).forEach(([k, v]) => {
        value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      });
    }
    return value;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

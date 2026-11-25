// src/lib/i18n/server.js
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';

/** @typedef {Record<string, string>} Dictionary */
const locales = /** @type {Record<'en' | 'es' | 'fr', Dictionary>} */ ({ en, es, fr });

/** @param {'en' | 'es' | 'fr'} [locale] */
export function getTranslation(locale = 'en') {
  const translation = locales[locale] || locales.en;
  
  /** @param {string} key */
  return function(key) {
    // Try exact match
    let result = translation[key];
    
    // If not found, try lowercase version (for consistency)
    if (!result) {
      result = translation[key.toLowerCase()];
    }
    
    // Fallback to English if still not found
    if (!result && locale !== 'en') {
      result = locales.en[key] || locales.en[key.toLowerCase()];
    }
    
    // If still not found, return the key itself
    return result || key;
  };
}

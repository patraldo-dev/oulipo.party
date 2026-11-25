// src/lib/i18n/index.js
import { writable, derived } from 'svelte/store';

// Import all translations at build time (no race conditions!)
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';

/** @typedef {Record<string, string>} Dictionary */
const translations = /** @type {Record<'en' | 'es' | 'fr', Dictionary>} */ ({ en, es, fr });

// Create a writable store for the current locale
export const locale = writable('en'); // Until the member's language arrives from the server

// Available locales
export const locales = ['en', 'es', 'fr'];

export const t = derived(locale, ($locale) => {
  /** @param {string} key */
  return (key) => {
    // Try exact match
    let translation = translations[/** @type {'en' | 'es' | 'fr'} */ ($locale)]?.[key];
    
    // If not found, try lowercase version
    if (!translation) {
      translation = translations[/** @type {'en' | 'es' | 'fr'} */ ($locale)]?.[key.toLowerCase()];
    }
    
    return translation || key;
  };
});

/**
 * Fill {name} placeholders in an already translated string.
 * @param {string} text
 * @param {Record<string, string | number>} values
 */
export const fill = (text, values) =>
  Object.entries(values).reduce(
    (out, [name, value]) => out.split(`{${name}}`).join(String(value)),
    text
  );

// Helper to set locale
/** @param {string} newLocale */
export function setLocale(newLocale) {
  if (locales.includes(newLocale)) {
    locale.set(newLocale);
  }
}

// Helper to get current locale value
export function getLocale() {
  let currentLocale;
  locale.subscribe(value => currentLocale = value)();
  return currentLocale;
}

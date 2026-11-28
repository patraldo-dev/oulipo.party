// src/lib/spell.js
// The editor's pre-submit check: which of a piece's words the dictionary does
// not know. Advisory only — names, coinages and borrowed words are a writer's
// business — so the caller offers "send anyway" rather than refusing.
// The dictionaries are hunspell's, one per language, fetched from the site's
// own static files on first use (see static/dictionaries/README.md).
import nspell from 'nspell';

/** @typedef {{ correct(word: string): boolean }} Checker */

/** @type {Record<string, Checker | undefined>} */
const loaded = {};
/** @type {Record<string, Promise<Checker | null> | undefined>} */
const pending = {};

/**
 * The language's dictionary, fetched once and kept. Null when it cannot be
 * had — in which case nothing is flagged, and the send goes ahead.
 * @param {string} lang
 * @returns {Promise<Checker | null>}
 */
async function checker(lang) {
    if (loaded[lang]) return loaded[lang] ?? null;
    if (!pending[lang]) {
        const made = (async () => {
            try {
                const [aff, dic] = await Promise.all([
                    fetch(`/dictionaries/${lang}.aff`).then((r) => (r.ok ? r.text() : '')),
                    fetch(`/dictionaries/${lang}.dic`).then((r) => (r.ok ? r.text() : ''))
                ]);
                if (!aff || !dic) return null;
                const made = /** @type {unknown} */ (nspell(aff, dic));
                loaded[lang] = /** @type {Checker} */ (made);
                return made;
            } catch {
                return null;
            } finally {
                pending[lang] = undefined;
            }
        })();
        pending[lang] = /** @type {Promise<Checker | null>} */ (made);
    }
    return pending[lang] ?? null;
}

/**
 * The piece's distinct words the dictionary does not know, in the order they
 * first appear. Words of two letters or more, folded to lower case; anything
 * with a digit is left alone. Capped, so a page of code cannot stall a send.
 * @param {string} text
 * @param {string} lang
 * @returns {Promise<string[]>}
 */
export async function suspiciousWords(text, lang) {
    const ns = await checker(lang);
    if (!ns) return [];
    const seen = new Set();
    const words = String(text ?? '')
        .toLowerCase()
        .match(/[\p{L}][\p{L}'’-]*[\p{L}]/gu);
    const found = [];
    for (const word of words ?? []) {
        if (seen.has(word)) continue;
        seen.add(word);
        if (!ns.correct(word)) {
            found.push(word);
            if (found.length >= 200) break;
        }
    }
    return found;
}

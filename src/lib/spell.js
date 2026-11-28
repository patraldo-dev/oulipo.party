// src/lib/spell.js
// The editor's pre-submit check: which of a piece's words the dictionary does
// not know. Advisory only — the caller names them once and a second press
// sends anyway. A word that appears capitalized anywhere in the piece is
// taken for a proper noun — a name, a place — and never flagged: the writer's
// people and places are not spelling errors. The dictionaries are hunspell's,
// one per language, fetched from the site's own static files on first use
// (see static/dictionaries/README.md).
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
                const instance = /** @type {unknown} */ (nspell(aff, dic));
                loaded[lang] = /** @type {Checker} */ (instance);
                return loaded[lang];
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
 * first appear, said the way the piece says them. Words of two letters or
 * more; a word written capitalized anywhere in the piece is a proper noun
 * and skips the check. Capped, so a page of code cannot stall a send.
 * @param {string} text
 * @param {string} lang
 * @returns {Promise<string[]>}
 */
export async function suspiciousWords(text, lang) {
    const ns = await checker(lang);
    if (!ns) return [];
    /** @type {Map<string, { capitalized: boolean, display: string }>} */
    const seen = new Map();
    for (const token of String(text ?? '').match(/[\p{L}][\p{L}'’-]*[\p{L}]/gu) ?? []) {
        const lower = token.toLowerCase();
        if (lower.length < 2) continue;
        let entry = seen.get(lower);
        if (!entry) {
            entry = { capitalized: false, display: token };
            seen.set(lower, entry);
        }
        if (/^\p{Lu}/u.test(token)) entry.capitalized = true;
    }
    const found = [];
    for (const [lower, entry] of seen) {
        if (entry.capitalized) continue;
        if (!ns.correct(lower)) {
            found.push(entry.display);
            if (found.length >= 200) break;
        }
    }
    return found;
}

// src/lib/marks.js
// Split a text where the server marked it, so a page can show a hit or a
// word that slipped as a highlight. Pure; the Duel and the Siege both use it.

/** @typedef {import('#lib/oulipo/types.js').Span} Span */
/** A run of a text: plain, or one the server marked. @typedef {{ text: string, hit: boolean }} Part */

/**
 * Split a text into plain and marked parts, at the server's positions.
 * @param {string} text
 * @param {Span[]} spans
 * @returns {Part[]}
 */
export function segments(text, spans) {
    /** @type {Part[]} */
    const parts = [];
    /** @param {number} start @param {number} end @param {boolean} hit */
    const push = (start, end, hit) => {
        if (end > start) parts.push({ text: text.slice(start, end), hit });
    };
    let at = 0;
    for (const span of spans) {
        push(at, span.start, false);
        push(span.start, span.end, true);
        at = span.end;
    }
    push(at, text.length, false);
    return parts;
}

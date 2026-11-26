// src/lib/piece.js
// What a game takes from a player's piece. Pure, and the same in the browser
// and in tests. The Duel and the Siege both draw on it; the writing space
// (src/lib/components/WritingSpace.svelte) only holds the piece.
import { analyze, countWords, defaultPolicy } from '#lib/oulipo/engine.js';
import { DUEL } from '#lib/oulipo/duel-rules.js';
import { fitPiece } from '#lib/import-text.js';

/** @typedef {import('#lib/oulipo/types.js').Lang} Lang */
/** @typedef {import('#lib/oulipo/types.js').WordType} WordType */

/**
 * The part of a piece that goes into a game. A piece longer than a game
 * takes is not refused: its first words are what count.
 * @param {string} story
 */
const countedPart = (story) => fitPiece(story, DUEL.maxStoryWords, DUEL.maxStoryChars).text;

/** As much of a file as the box holds. What counts is decided from the box, never from the file.
 *  @param {string} text */
export const fitForBox = (text) => fitPiece(text, Number.POSITIVE_INFINITY, DUEL.maxStoryChars);

/**
 * The line under the box: which message it carries and the numbers to fill
 * into it. `off` is the colour: a piece with something written that is still
 * too short is the one case that is a fault.
 * @param {string} story
 * @returns {{ key: 'duel.too_short' | 'duel.truncated' | 'duel.words', n: number, total: number, off: boolean }}
 */
export function countLine(story) {
    const wordCount = countWords(countedPart(story));
    const totalWords = countWords(story);
    if (wordCount < DUEL.minStoryWords) return { key: 'duel.too_short', n: DUEL.minStoryWords, total: 0, off: totalWords > 0 };
    if (wordCount < totalWords) return { key: 'duel.truncated', n: DUEL.maxStoryWords, total: totalWords, off: false };
    return { key: 'duel.words', n: wordCount, total: 0, off: false };
}

/**
 * What a game takes from a piece: the part that counts, whether there is
 * enough of it to send words from, and its distinct words. The words to send
 * are picked from the part that counts, so nothing can be sent that is not
 * in the game.
 * @param {string} story
 * @param {Lang} lang
 * @returns {{ counted: string, wordCount: number, storyFits: boolean, candidates: WordType[] }}
 */
export function pieceView(story, lang) {
    const counted = countedPart(story);
    const wordCount = countWords(counted);
    return {
        counted,
        wordCount,
        storyFits: wordCount >= DUEL.minStoryWords,
        candidates: analyze(counted, lang, defaultPolicy(lang)).types
    };
}

/**
 * The piece kept in this browser on a former visit, or nothing. The server
 * has none to read, so a page rendered there starts from an empty box.
 * @param {string} key
 * @returns {string}
 */
export function savedPiece(key) {
    if (typeof localStorage === 'undefined') return '';
    try {
        return localStorage.getItem(key) ?? '';
    } catch {
        // A browser that refuses storage keeps nothing; the rest works.
        return '';
    }
}

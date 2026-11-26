// What a game takes from a piece: node --test tests/piece.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { countLine, fitForBox, pieceView, savedPiece } from '../src/lib/piece.js';
import { DUEL } from '../src/lib/oulipo/duel-rules.js';
import { countWords } from '../src/lib/oulipo/engine.js';

// No "s": the engine folds a plural into its family, and these words must stay distinct.
const LETTERS = 'abcdefghijklmnopqrtuvwxyz';
/** Distinct words of letters only (the engine reads letters, not digits). @param {number} n @param {number} [from] */
const words = (n, from = 0) =>
    Array.from({ length: n }, (_, i) => 'word' + [...(from + i).toString(LETTERS.length)].map((digit) => LETTERS[Number.parseInt(digit, LETTERS.length)]).join('')).join(' ');

test('a piece that fits is taken whole, and the line under the box counts it', () => {
    const piece = words(120);
    assert.deepEqual(countLine(piece), { key: 'duel.words', n: 120, total: 0, off: false });
    const view = pieceView(piece, 'en');
    assert.equal(view.counted, piece);
    assert.equal(view.wordCount, 120);
    assert.equal(view.storyFits, true);
    assert.equal(view.candidates.length, 120, 'every distinct word is one to send');
});

test('a piece longer than a game takes counts its first words only, and the words to send come from those', () => {
    const piece = words(DUEL.maxStoryWords + 40);
    const line = countLine(piece);
    assert.equal(line.key, 'duel.truncated');
    assert.equal(line.n, DUEL.maxStoryWords);
    assert.equal(line.total, DUEL.maxStoryWords + 40);
    assert.equal(line.off, false, 'a long piece is not a fault');
    const view = pieceView(piece, 'en');
    assert.equal(view.wordCount, DUEL.maxStoryWords);
    assert.equal(countWords(view.counted), DUEL.maxStoryWords, 'cut on a word, never inside one');
    assert.equal(view.candidates.length, DUEL.maxStoryWords);
    assert.ok(view.candidates.every((type) => view.counted.includes(type.display)));
});

test('too short a piece is a fault once something is written, and nothing at all is not', () => {
    assert.deepEqual(countLine(''), { key: 'duel.too_short', n: DUEL.minStoryWords, total: 0, off: false });
    assert.deepEqual(countLine(words(12)), { key: 'duel.too_short', n: DUEL.minStoryWords, total: 0, off: true });
    assert.equal(pieceView(words(12), 'en').storyFits, false);
    assert.equal(pieceView(words(DUEL.minStoryWords), 'en').storyFits, true);
});

test('a file fills the box up to what the box holds, whole words only', () => {
    const fitted = fitForBox('word '.repeat(5000).trim());
    assert.equal(fitted.cut, true);
    assert.ok(fitted.text.length <= DUEL.maxStoryChars);
    assert.equal(fitted.text.endsWith('word'), true);
    assert.deepEqual(fitForBox('a short file'), { text: 'a short file', cut: false });
});

test('a kept piece is the browser’s to read: there is none where there is no browser', () => {
    assert.equal(savedPiece('any'), '');
});

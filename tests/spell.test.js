// The editor's pre-submit spell check: node --test tests/spell.test.js
// A tiny dictionary stands in for the real hunspell files; fetch is pointed
// at it, so suspiciousWords is exercised exactly as the page runs it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { suspiciousWords } from '../src/lib/spell.js';

const AFF = 'SET UTF-8\n';
// The .dic's first line is its word count; the rest are words.
const WORDS_ES = ['la', 'guardiana', 'del', 'faro', 'vio', 'un', 'y', 'otro', 'junto', 'a', 'gaviota', 'escribió'];
const WORDS_EN = ['and', 'the', 'dog', 'followed', 'whole', 'road'];
const DIC = (words) => [String(words.length), ...words].join('\n');

test('unknown words are named in order, said as the piece says them; capitalized names skip', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => ({
        ok: true,
        text: async () => (String(url).endsWith('.aff') ? AFF : DIC(String(url).includes('/en.') ? WORDS_EN : WORDS_ES))
    });
    try {
        const bad = await suspiciousWords(
            'La guardiana del faro vio un xilofón qrzz y otro xilofón junto a la gaviota escribió.',
            'es'
        );
        assert.deepEqual(bad, ['xilofón', 'qrzz']);
        // A name written capitalized — Lawrence, María — is a proper noun,
        // however few letters it shares with the dictionary.
        const names = await suspiciousWords(
            'Lawrence and María walked the whole road, and the dog followed.',
            'en'
        );
        assert.deepEqual(names, ['walked']);
    } finally {
        globalThis.fetch = original;
    }
});

test('a dictionary that cannot be had says nothing and stands in nobody’s way', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, text: async () => '' });
    try {
        assert.deepEqual(await suspiciousWords('mots qrzz étranges', 'fr'), []);
    } finally {
        globalThis.fetch = original;
    }
});

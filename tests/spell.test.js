// The editor's pre-submit spell check: node --test tests/spell.test.js
// A tiny dictionary stands in for the real hunspell files; fetch is pointed
// at it, so suspiciousWords is exercised exactly as the page runs it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { suspiciousWords } from '../src/lib/spell.js';

const AFF = 'SET UTF-8\n';
// The .dic's first line is its word count; the rest are words.
const WORDS = ['la', 'guardiana', 'del', 'faro', 'vio', 'un', 'y', 'otro', 'junto', 'a', 'gaviota', 'escribió'];
const DIC = [String(WORDS.length), ...WORDS].join('\n');

test('words the dictionary does not know are named, in order, once each', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => ({
        ok: true,
        text: async () => (String(url).endsWith('.aff') ? AFF : DIC)
    });
    try {
        const bad = await suspiciousWords(
            'La guardiana del faro vio un xilofón qrzz y otro xilofón junto a la gaviota escribió.',
            'es'
        );
        assert.deepEqual(bad, ['xilofón', 'qrzz']);
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

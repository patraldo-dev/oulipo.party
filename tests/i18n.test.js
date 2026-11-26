// tests/i18n.test.js
// The three languages must offer the same words. A key missing from one is
// shown to that language's members as the key itself, and nothing else fails,
// in tests, in the type check or in the build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** @typedef {Record<string, string>} Dictionary */

const NAMES = ['en', 'es', 'fr'];

/** @param {string} name @returns {Dictionary} */
const read = (name) =>
    /** @type {Dictionary} */ (
        JSON.parse(readFileSync(new URL(`../src/lib/i18n/locales/${name}.json`, import.meta.url), 'utf8'))
    );

/** @type {Record<string, Dictionary>} */
const dictionaries = Object.fromEntries(NAMES.map((name) => [name, read(name)]));

/** The `{name}` holes a message leaves to be filled. @param {string} text */
const holes = (text) => (text.match(/\{[a-z_]+\}/g) ?? []).sort();

test('the three languages carry the same keys', () => {
    const keys = NAMES.map((name) => Object.keys(dictionaries[name]).sort());
    assert.deepEqual(keys[1], keys[0], 'Spanish is missing or adds keys');
    assert.deepEqual(keys[2], keys[0], 'French is missing or adds keys');
});

test('every key says something in every language', () => {
    for (const name of NAMES) {
        for (const [key, value] of Object.entries(dictionaries[name])) {
            assert.ok(value.trim().length > 0, `${name}: "${key}" is empty`);
        }
    }
});

test('a translation leaves no hole the English message does not', () => {
    // An unknown hole would reach the member spelled out, since only the
    // names a message is given are filled.
    for (const name of NAMES.slice(1)) {
        for (const [key, value] of Object.entries(dictionaries[name])) {
            for (const hole of holes(value)) {
                assert.ok(holes(dictionaries.en[key]).includes(hole), `${name}: "${key}" fills ${hole}, English does not`);
            }
        }
    }
});

test('a message with a number in one language keeps it in the others', () => {
    // The other way round matters for the count: a language that dropped {n}
    // would tell its members a number-less version of the same sentence.
    for (const name of NAMES.slice(1)) {
        for (const [key, value] of Object.entries(dictionaries.en)) {
            for (const hole of holes(value)) {
                assert.ok(holes(dictionaries[name][key]).includes(hole), `${name}: "${key}" lost ${hole}`);
            }
        }
    }
});

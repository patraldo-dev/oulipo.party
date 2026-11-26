// The rules of the Siege: node --test tests/siege-rules.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { SIEGE, isCode, newCode, normalizeCode, scoreSiege, siegeTable } from '../src/lib/oulipo/siege-rules.js';
import { analyze, defaultPolicy, judge } from '../src/lib/oulipo/engine.js';
import { SCENES } from './helpers.js';

const { story, draft } = SCENES.en;
const policy = defaultPolicy('en');
/** @param {{ userId: string, story: string, ropes: string[] }[]} entries @param {string} [prompt] */
const score = (entries, prompt = 'A prompt of the day.') => scoreSiege({ draft, locale: 'en', prompt, entries });
const player = (userId, ropes) => ({ userId, story, ropes });
const byName = (scored, userId) => scored.players.find((one) => one.userId === userId);

test('every player is judged against the same piece, as in the Duel', () => {
    const scored = score([player('a', ['lighthouse', 'gull'])]);
    const verdict = judge(story, draft, 'en', policy, ['lighthouse', 'gull']);
    assert.equal(byName(scored, 'a').hits, verdict.hits);
    assert.equal(byName(scored, 'a').misses, verdict.misses);
    assert.equal(byName(scored, 'a').score, verdict.score, 'with nobody else in the room there is nothing to add');
});

test('a hit only one player found is worth more, a hit every player found is worth more still', () => {
    // Lighthouse is in her piece, lamp and father are too; gull is not.
    const scored = score([
        player('a', ['lighthouse', 'gull', 'lamp']),
        player('b', ['lighthouse', 'gull']),
        player('c', ['lighthouse', 'father'])
    ]);
    const a = byName(scored, 'a');
    const b = byName(scored, 'b');
    const c = byName(scored, 'c');
    const tags = (one) => Object.fromEntries(one.ropes.map((rope) => [rope.key, rope.tag]));

    // A: two hits and a miss (+1), lamp found alone (+1), lighthouse found by all three (+3).
    assert.deepEqual([a.hits, a.misses, a.original, a.unanimous, a.bonus, a.score], [2, 1, 1, 1, 4, 5]);
    assert.deepEqual(tags(a), { lighthouse: 'unanimous', gull: 'plain', lamp: 'original' });
    // B: a hit and a miss (0), lighthouse found by all three (+3).
    assert.deepEqual([b.hits, b.misses, b.original, b.unanimous, b.bonus, b.score], [1, 1, 0, 1, 3, 3]);
    // C: two hits (+2), father found alone (+1), lighthouse found by all three (+3).
    assert.deepEqual([c.hits, c.misses, c.original, c.unanimous, c.bonus, c.score], [2, 0, 1, 1, 4, 6]);

    // A word some but not all sent is a plain hit.
    const some = score([player('a', ['lamp']), player('b', ['lamp']), player('c', ['father'])]);
    assert.equal(byName(some, 'a').ropes[0].tag, 'plain');
    assert.equal(byName(some, 'a').bonus, 0);
});

test('a miss earns nothing, whoever sent it', () => {
    const scored = score([player('a', ['gull']), player('b', ['gull']), player('c', ['gull'])]);
    for (const one of scored.players) {
        assert.equal(one.ropes[0].tag, 'plain');
        assert.equal(one.bonus, 0);
        assert.equal(one.score, -1);
    }
    // So sending everything stays as risky as in the Duel.
    const everything = analyze(story, 'en').types.map((type) => type.key);
    const greedy = score([player('a', everything), player('b', ['lighthouse'])]);
    assert.ok(byName(greedy, 'a').score < byName(greedy, 'b').score, 'the player who sent everything scores less');
});

test('a word of the prompt earns no bonus: every player echoes the prompt', () => {
    const scored = score(
        [player('a', ['lighthouse', 'gull', 'lamp']), player('b', ['lighthouse', 'gull']), player('c', ['lighthouse', 'father'])],
        'The lamp burns in the lighthouse.'
    );
    const a = byName(scored, 'a');
    // Lighthouse and lamp are the prompt's words: hits, and no more.
    assert.deepEqual(Object.fromEntries(a.ropes.map((rope) => [rope.key, rope.tag])), { lighthouse: 'prompt', gull: 'plain', lamp: 'prompt' });
    assert.deepEqual([a.original, a.unanimous, a.bonus], [0, 0, 0]);
    // Father is not in the prompt: still found alone.
    assert.equal(byName(scored, 'c').ropes.find((rope) => rope.key === 'father').tag, 'original');
});

test('a hit every player found is worth more the more players there are', () => {
    const two = score([player('a', ['lighthouse']), player('b', ['lighthouse'])]);
    const four = score(['a', 'b', 'c', 'd'].map((id) => player(id, ['lighthouse'])));
    assert.equal(byName(two, 'a').score, 1 + 2 * SIEGE.unanimousEach);
    assert.equal(byName(four, 'a').score, 1 + 4 * SIEGE.unanimousEach);
});

test('the union is every word anyone sent, in every form, and the muzzle is anyone’s hits', () => {
    const scored = score([player('a', ['lighthouse', 'gull', 'lamp']), player('b', ['lighthouse']), player('c', ['father'])]);
    assert.deepEqual(scored.union.keys.sort(), ['father', 'gull', 'lamp', 'lighthouse']);
    assert.ok(scored.union.forms.includes('gulls'), 'the form it took in a story');
    assert.ok(scored.union.forms.includes('keeper') === false, 'a word nobody sent is not in the union');
    const anyone = judge(story, draft, 'en', policy, ['lighthouse', 'lamp', 'father']);
    assert.equal(scored.muzzlePct, anyone.muzzlePct);
});

test('the table is ordered by score, then hits, then original hits, and a tie shares a place', () => {
    const scored = score([player('a', ['lighthouse', 'gull', 'lamp']), player('b', ['lighthouse', 'gull']), player('c', ['lighthouse', 'father'])]);
    const names = [{ userId: 'a', name: 'Ana' }, { userId: 'b', name: 'Bo' }, { userId: 'c', name: 'Cleo' }];
    const table = siegeTable(scored, names, 'b');
    assert.deepEqual(
        table.map((row) => row.name),
        ['Cleo', 'Ana', 'Bo']
    );
    assert.deepEqual(
        table.map((row) => row.rank),
        [1, 2, 3]
    );
    assert.deepEqual(
        table.map((row) => row.mine),
        [false, false, true]
    );
    const tied = score([player('a', ['lamp']), player('b', ['father']), player('c', ['gull'])]);
    assert.deepEqual(
        siegeTable(tied, names).map((row) => row.rank),
        [1, 1, 3]
    );
});

test('a code is read as a player may type it, and only a well-formed one is a code', () => {
    assert.equal(normalizeCode(' k7q f2 '), 'K7QF2');
    assert.equal(normalizeCode('k7q-f2'), 'K7QF2');
    assert.equal(isCode('K7QF2'), true);
    for (const bad of ['K7QF', 'K7QF2X', 'K7QFI', 'K7QF0', 'K7QF€', '']) assert.equal(isCode(bad), false, bad);
    const codes = Array.from({ length: 200 }, () => newCode());
    assert.ok(codes.every(isCode));
    assert.ok(new Set(codes).size > 190, 'codes do not repeat themselves soon');
    assert.ok(!SIEGE.codeAlphabet.match(/[01ILO]/), 'no symbol that reads as another');
});

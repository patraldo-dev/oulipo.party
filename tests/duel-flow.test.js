// Server flow tests: node --test tests/oulipo/
// The whole duel runs against in-memory SQLite and a scripted AI binding.
// Where the behaviour is meant to match, fr, en and es go through the same
// scenario (SCENES in ./helpers.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import { analyze, countWords } from '../src/lib/oulipo/engine.js';
import { DUEL, SIDE_BET, contractName, contractPays, potFor, wagerScore } from '../src/lib/oulipo/duel-rules.js';
import {
    DuelError,
    duelDay,
    getBoard,
    lockDuel,
    prepareDuel,
    readDraftById,
    readLatestLocked,
    readOpenRound,
    readPrompt,
    readRoundById,
    readStreak,
    rewriteDuel,
    roundView
} from '../src/lib/server/oulipo-duel.js';
import { runRewrite } from '../src/lib/server/oulipo-sappho.js';
import { SAPPHO_DUEL_PERSONAS, SAPPHO_MODEL, SAPPHO_PERSONAS, SAPPHO_REWRITE } from '../src/lib/server/sappho-persona.js';
import { getToday } from '../src/lib/server/day.js';
import { addPrompt, addUser, fakeAi, SCENES, SqliteD1 } from './helpers.js';
import { placeWager, readPurse } from '../src/lib/server/purse.js';

const DAY = '2026-11-23';
const keysOf = (story, lang) => analyze(story, lang).types.map((type) => type.key);

async function setup(lang = 'es', scene = SCENES.es) {
    const db = new SqliteD1();
    await addUser(db, 'player');
    await addPrompt(db, DAY, lang, 'The prompt of the day');
    // Preparing the member's round writes its hidden piece: the scripted
    // engine answers with the scene's draft, so the fixture is what locks.
    await prepareDuel(db, fakeAi([scene.draft]), 'player', lang, DAY);
    return db;
}

const lock = (db, overrides = {}) =>
    lockDuel(db, fakeAi(), {
        userId: 'player',
        locale: 'es',
        day: DAY,
        story: SCENES.es.story,
        ropes: keysOf(SCENES.es.story, 'es'),
        ...overrides
    });

async function rejectsCode(promise, status, code) {
    await assert.rejects(promise, (error) => {
        assert.ok(error instanceof DuelError, `expected DuelError, got ${error}`);
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        return true;
    });
}

const wordsAt = (text, spans) => spans.map((span) => text.slice(span.start, span.end));

// ── The hidden draft ───────────────────────────────────────────────────

test('prepare makes a round with its own hidden piece, and reuses the one being written', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    const ai = fakeAi(['Write about the rain that came at last, after a long dry summer.', 'Her hidden piece, about rain.']);
    const first = await prepareDuel(db, ai, 'player', 'es', DAY);
    assert.equal(first.prompt.text, 'Write about the rain that came at last, after a long dry summer.');
    assert.equal(typeof first.prompt.id, 'string');
    assert.equal(first.draftReady, true);
    assert.deepEqual(Object.keys(first).sort(), ['draftReady', 'prompt', 'roundId']);
    assert.ok(!JSON.stringify(first).includes('hidden piece'), 'the draft must not leak before locking');

    // Preparing again keeps the round already being written: no second piece.
    const second = await prepareDuel(db, fakeAi(), 'player', 'es', DAY);
    assert.equal(second.roundId, first.roundId);
    assert.equal(ai.calls.length, 2, 'an existing piece is not written again');
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM oulipo_duel_drafts')[0].n, 1);
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'writing'`)[0].n, 1);

    // Another member's round is another hidden piece, against the same prompt.
    await addUser(db, 'other');
    await prepareDuel(db, fakeAi(['Rain, at last, after the long dry summer, and a piece about it.']), 'other', 'es', DAY);
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM daily_prompts')[0].n, 1, 'one prompt for the day');
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM oulipo_duel_drafts')[0].n, 2);
    const pieces = db.rows('SELECT content FROM oulipo_duel_drafts').map((row) => row.content);
    assert.notEqual(pieces[0], pieces[1], 'no two rounds share a hidden piece');
});

test('prepare has the day\'s prompt written first, then asks Sappho with her own voice', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    const ai = fakeAi(['Write about a door left open on the last night of winter.', '  Her piece for the prompt.  ']);
    await prepareDuel(db, ai, 'player', 'fr', DAY);
    assert.equal(ai.calls[0].model, '@cf/mistralai/mistral-small-3.1-24b-instruct', 'the prompt generator');
    assert.equal(ai.calls[1].model, SAPPHO_MODEL);
    assert.equal(ai.calls[1].input.max_tokens, DUEL.maxDraftTokens);
    assert.equal(ai.calls[1].input.messages[0].content, SAPPHO_DUEL_PERSONAS.fr);
    assert.equal(
        ai.calls[1].input.messages[1].content,
        'Prompt: Write about a door left open on the last night of winter.\n\nWrite your response:'
    );
    assert.equal(db.rows('SELECT content FROM oulipo_duel_drafts')[0].content, 'Her piece for the prompt.', 'trimmed');
    assert.equal((await readPrompt(db, DAY, 'fr')).prompt_text, 'Write about a door left open on the last night of winter.');
});

test('three players arriving at once get one prompt and a piece each', async () => {
    const db = new SqliteD1();
    for (const who of ['ana', 'bo', 'cy']) await addUser(db, who);
    // Which request receives which answer depends on timing, so every answer
    // must be usable as either the prompt or a piece.
    const lines = ['one', 'two', 'three', 'four', 'five', 'six'].map(
        (n) => `Turn ${n}: a long enough answer for whatever is being asked.`
    );
    const ai = fakeAi(lines);
    const results = await Promise.all([
        prepareDuel(db, ai, 'ana', 'en', DAY),
        prepareDuel(db, ai, 'bo', 'en', DAY),
        prepareDuel(db, ai, 'cy', 'en', DAY)
    ]);
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM daily_prompts')[0].n, 1, 'one prompt for the day');
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM oulipo_duel_drafts')[0].n, 3, 'a piece per round');
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'writing'`)[0].n, 3);
    assert.ok(results.every((result) => result.draftReady));
    const kept = db.rows('SELECT prompt_text FROM daily_prompts')[0].prompt_text;
    assert.ok(results.every((result) => result.prompt.text === kept), 'everyone is told the prompt that was kept');
    // Three rounds, three distinct pieces of theirs.
    const rounds = db.rows('SELECT draft_id FROM oulipo_duel_rounds').map((row) => row.draft_id);
    assert.equal(new Set(rounds).size, 3, 'no round shares its piece');
});

test('prepare fails cleanly when Sappho cannot write', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    await addPrompt(db, DAY, 'es', 'Prompt.');
    await rejectsCode(prepareDuel(db, fakeAi(['']), 'player', 'es', DAY), 503, 'draft_failed');
    await rejectsCode(prepareDuel(db, fakeAi([new Error('gateway down')]), 'player', 'es', DAY), 503, 'draft_failed');
    await rejectsCode(prepareDuel(db, null, 'player', 'es', DAY), 503, 'no_engine');
    await rejectsCode(prepareDuel(db, fakeAi(['x']), 'player', 'de', DAY), 400, 'bad_language');
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM oulipo_duel_drafts')[0].n, 0);
});

// ── Locking ────────────────────────────────────────────────────────────

test('lock and rewrite run the same way in fr, en and es', async () => {
    for (const [lang, scene] of Object.entries(SCENES)) {
        const db = new SqliteD1();
        await addUser(db, `player-${lang}`);
        await addPrompt(db, DAY, lang, 'The prompt of the day');
        await prepareDuel(db, fakeAi([scene.draft]), `player-${lang}`, lang, DAY);
        const view = await lockDuel(db, fakeAi(), {
            userId: `player-${lang}`,
            locale: lang,
            day: DAY,
            story: scene.story,
            ropes: scene.ropes
        });
        assert.equal(view.locale, lang);
        assert.equal(view.policy.verbs, 'strict', lang);
        // lighthouse / gulls / lamp / father and their equivalents: three are in the draft, the gulls are not.
        assert.deepEqual(
            view.ropes.map((rope) => rope.hit),
            [true, false, true, true],
            lang
        );
        assert.equal(view.hits, 3, lang);
        assert.equal(view.misses, 1, lang);
        // The wager: the pot is the piece, the craft grade multiplies, and a
        // four-word send is the moon shot. The engine answered dry, so the
        // grade is able (×1).
        const pot = potFor(countWords(scene.story));
        assert.equal(view.pot, pot, lang);
        assert.equal(view.craft, 1, lang);
        assert.equal(view.score, Math.round((3 * pot) / 4), lang);
        assert.ok(Math.abs(view.pays - pot / 4) < 1e-12, lang);
        assert.equal(view.contractName, 0, lang);
        assert.equal(view.ropeCount, 4, lang);
        assert.equal(view.draft.text, scene.draft, lang);
        assert.ok(view.draft.spans.length >= 3 && view.draft.spans.length <= 6, `${lang}: ${view.draft.spans.length}`);
        assert.deepEqual(view.rewrite, { status: 'pending', attempts: 0, violations: [], text: '', spans: [] }, lang);
        assert.equal(view.tier, 0, lang);

        const ai = fakeAi([scene.rewrite]);
        const after = await rewriteDuel(db, ai, { userId: `player-${lang}`, day: DAY });
        assert.equal(after.rewrite.status, 'clean', lang);
        assert.equal(after.rewrite.attempts, 1, lang);
        assert.equal(after.rewrite.text, scene.rewrite, lang);
        assert.deepEqual(after.rewrite.spans, [], lang);
        assert.equal(ai.calls.length, 1, lang);
        assert.equal(ai.calls[0].input.messages[0].content.startsWith(SAPPHO_DUEL_PERSONAS[lang]), true, lang);
        assert.ok(ai.calls[0].input.messages[1].content.includes(scene.draft), `${lang}: the piece travels with the request`);
    }
});

test('lock reveals the draft with every sent word marked at its position', async () => {
    const db = await setup();
    const view = await lock(db, { ropes: ['guardiana', 'padre'] });
    assert.deepEqual(wordsAt(view.draft.text, view.draft.spans), ['guardiana', 'padre']);
    assert.deepEqual(
        view.ropes.map((rope) => ({ key: rope.key, forms: rope.forms, draftForms: rope.draftForms })),
        [
            { key: 'guardiana', forms: ['guardiana'], draftForms: ['guardiana'] },
            { key: 'padre', forms: ['padre'], draftForms: ['padre'] }
        ]
    );
    const stored = await readLatestLocked(db, 'player', DAY);
    assert.equal(stored.story, SCENES.es.story);
    assert.equal(stored.policy, '{"verbs":"strict"}');
    assert.equal(stored.rewrite_status, 'pending');
    assert.deepEqual(JSON.parse(stored.ropes).map((rope) => rope.key), ['guardiana', 'padre']);
    const seen = await roundView(db, stored, await readDraftById(db, String(stored.draft_id)));
    assert.equal(seen.id, view.id);
});

test('lock refuses stories outside the limits', async () => {
    const db = await setup();
    const words = (n) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');
    await rejectsCode(lock(db, { story: '' }), 400, 'story_missing');
    await rejectsCode(lock(db, { story: '   ' }), 400, 'story_missing');
    await rejectsCode(lock(db, { story: null }), 400, 'story_missing');
    await rejectsCode(lock(db, { story: words(DUEL.minStoryWords - 1) }), 400, 'story_too_short');
    await rejectsCode(lock(db, { story: words(DUEL.maxStoryWords + 1) }), 400, 'story_too_long');
    await rejectsCode(lock(db, { story: 'a'.repeat(DUEL.maxStoryChars + 1) }), 400, 'story_too_long');
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'locked'`)[0].n, 0);
});

test('lock accepts a story exactly at the limits', async () => {
    const db = await setup();
    await addUser(db, 'other');
    const filler = (n) => Array.from({ length: n }, () => 'palabra').join(' ');
    const shortest = await lock(db, { story: `guardiana padre ${filler(DUEL.minStoryWords - 2)}`, ropes: ['padre'] });
    assert.equal(shortest.story.split(' ').length, DUEL.minStoryWords);
    const longest = await lockDuel(db, fakeAi([SCENES.es.draft]), {
        userId: 'other',
        locale: 'es',
        day: DAY,
        story: `padre ${filler(DUEL.maxStoryWords - 1)}`,
        ropes: ['padre']
    });
    assert.equal(longest.story.split(' ').length, DUEL.maxStoryWords);
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'locked'`)[0].n, 2);
});

test('lock re-checks every rope against the story on the server', async () => {
    const db = await setup();
    await rejectsCode(lock(db, { ropes: [] }), 400, 'ropes_missing');
    await rejectsCode(lock(db, { ropes: 'padre' }), 400, 'ropes_missing');
    await rejectsCode(lock(db, { ropes: ['the'] }), 400, 'rope_not_in_story'); // a function word
    await rejectsCode(lock(db, { ropes: ['mar'] }), 400, 'rope_not_in_story'); // under four letters
    await rejectsCode(lock(db, { ropes: ['gaviotas'] }), 400, 'rope_not_in_story'); // a surface form, not its key
    await rejectsCode(lock(db, { ropes: ['miraba'] }), 400, 'rope_not_in_story'); // only in the draft
    await rejectsCode(lock(db, { ropes: ['GUARDIANA'] }), 400, 'rope_not_in_story'); // never folded by the client
    await rejectsCode(lock(db, { ropes: ['padre', 7, null, ''] }), 400, 'rope_not_in_story');
    await rejectsCode(lock(db, { ropes: ["padre' OR 1=1 --"] }), 400, 'rope_not_in_story');
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'locked'`)[0].n, 0);
});

test('the pot is the piece, and the pay falls in inverse proportion', () => {
    // One point of pot per fifteen words written, never below two.
    assert.deepEqual([29, 30, 45, 75, 150, 300].map((n) => potFor(n)), [2, 2, 3, 5, 10, 20]);
    // A hit pays the pot divided by the words sent.
    assert.equal(contractPays(1, 20), 20);
    assert.equal(contractPays(4, 20), 5);
    assert.ok(Math.abs(contractPays(9, 20) - 20 / 9) < 1e-12);
    assert.equal(contractPays(20, 20), 1);
    assert.ok(Math.abs(contractPays(95, 20) - 20 / 95) < 1e-12, 'the whole piece can go, a word at a time worth almost nothing');
    // The names label the dial's regions: 0 moon shot, 1 bold wager,
    // 2 steady hand, 3 full cord, 4 wide net, 5 buckshot.
    assert.deepEqual(
        [1, 4, 5, 8, 9, 14, 15, 20, 21, 40, 41, 150].map((n) => contractName(n)),
        [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    );
});

test('a perfect round scores the pot, times the craft grade', () => {
    // 4 hits at ×5 and 95 hits at 20/95 land on the same 20 — until craft.
    assert.equal(wagerScore(4, 4, 20, 1), 20);
    assert.equal(wagerScore(95, 95, 20, 1), 20);
    assert.equal(wagerScore(4, 4, 20, 3), 30, 'remarkable craft lifts the same round half as high again');
    assert.equal(wagerScore(4, 4, 20, 0), 15, 'plain craft pulls it down');
    assert.equal(wagerScore(4, 4, 20, null), 20, 'a grade nobody gave costs nothing');
    assert.equal(wagerScore(3, 4, 2, 1), 2, 'a thin piece plays for a thin pot');
    assert.equal(wagerScore(0, 30, 10, 1), 0, 'a miss costs nothing but its slot');
});

test('a word of the prompt is hers already: it cannot be sent', async () => {
    const db = await setup();
    // 'The prompt of the day' is the fixture's prompt; a piece that uses the
    // word "prompt" cannot send it, however it was picked.
    const story = `I keep a prompt above my desk and answer it every morning. ` +
        `The page fills slowly, one line after another, until the whole thing stands there, breathing. ` +
        `Some mornings the words arrive together; other mornings nothing comes at all, and I wait.`;
    const answer = keysOf(story, 'es').includes('prompt');
    assert.equal(answer, true, 'the fixture story must contain the prompt word for this test to mean anything');
    await rejectsCode(lock(db, { story, ropes: ['prompt'] }), 400, 'prompt_word');
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'locked'`)[0].n, 0);
});

test('the whole piece can be sent: no cap, and the pay shrinks in proportion', async () => {
    const db = await setup();
    const keys = keysOf(SCENES.es.story, 'es');
    assert.ok(keys.length > 20, 'the fixture has more keys than the old cap, for this test to mean anything');
    const view = await lock(db, { ropes: keys });
    assert.equal(view.ropeCount, keys.length);
    assert.equal(view.contractName, 4, 'a send of thirty is the wide net');
    const pot = potFor(countWords(SCENES.es.story));
    assert.ok(Math.abs(view.pays - pot / keys.length) < 1e-12);
    assert.equal(view.score, Math.round(view.hits * (pot / keys.length)));
    const stored = await readLatestLocked(db, 'player', DAY);
    assert.equal(stored.score, view.score);
});

test('misses cost nothing but their slot, and the ledger remembers every word', async () => {
    const db = await setup();
    // 'gaviota' is not in her draft: one miss, sent alone, scores zero — the
    // old scoring would have charged −1. Three words is the moon shot.
    const view = await lock(db, { ropes: ['guardiana', 'gaviota', 'padre'] });
    assert.equal(view.hits, 2);
    assert.equal(view.misses, 1);
    const pot = potFor(countWords(SCENES.es.story));
    const pays = contractPays(3, pot);
    assert.equal(view.score, Math.round((2 * pot) / 3), 'two hits at the moon shot’s share of the pot');
    assert.equal(view.contractName, 0);
    const ledger = db
        .rows('SELECT word_key, band, hit, contract, pays FROM duel_ledger ORDER BY word_key')
        .map((row) => ({ word_key: row.word_key, band: row.band, hit: row.hit, contract: row.contract, pays: Number(row.pays) }));
    assert.deepEqual(ledger, [
        { word_key: 'gaviota', band: 'other', hit: 0, contract: 3, pays },
        { word_key: 'guardiana', band: 'other', hit: 1, contract: 3, pays },
        { word_key: 'padre', band: 'other', hit: 1, contract: 3, pays }
    ]);
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM duel_ledger')[0].n, 3);
});

test('twelve rounds a day, and the thirteenth is refused before a piece is written', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    await addPrompt(db, DAY, 'es', 'The prompt of the day');
    for (let round = 0; round < DUEL.roundsPerDay; round++) {
        await prepareDuel(db, fakeAi([SCENES.es.draft]), 'player', 'es', DAY);
        await lockDuel(db, fakeAi(), { userId: 'player', locale: 'es', day: DAY, story: SCENES.es.story, ropes: ['padre'] });
    }
    await rejectsCode(prepareDuel(db, fakeAi([SCENES.es.draft]), 'player', 'es', DAY), 429, 'round_limit');
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'locked'`)[0].n, DUEL.roundsPerDay);
});

test('the craft grade reads one digit, and falls back to able on nonsense', async () => {
    const db = await setup();
    const vivid = await lockDuel(db, fakeAi(['2']), {
        userId: 'player', locale: 'es', day: DAY, story: SCENES.es.story, ropes: ['padre']
    });
    assert.equal(vivid.craft, 2);
    const pot = potFor(countWords(SCENES.es.story));
    assert.equal(vivid.score, Math.round(pot * 1.25), 'one hit, the whole pot, vivid ×1.25');

    const db2 = new SqliteD1();
    await addUser(db2, 'player');
    await addPrompt(db2, DAY, 'es', 'The prompt of the day');
    await prepareDuel(db2, fakeAi([SCENES.es.draft]), 'player', 'es', DAY);
    const plain = await lockDuel(db2, fakeAi(['the model wrote a paragraph instead']), {
        userId: 'player', locale: 'es', day: DAY, story: SCENES.es.story, ropes: ['padre']
    });
    assert.equal(plain.craft, 1, 'no digit in the answer grades as able');
    const db3 = new SqliteD1();
    await addUser(db3, 'player');
    await addPrompt(db3, DAY, 'es', 'The prompt of the day');
    await prepareDuel(db3, fakeAi([SCENES.es.draft]), 'player', 'es', DAY);
    const failed = await lockDuel(db3, fakeAi([new Error('gateway down')]), {
        userId: 'player', locale: 'es', day: DAY, story: SCENES.es.story, ropes: ['padre']
    });
    assert.equal(failed.craft, 1, 'a model that throws never punishes the writer');
});

test('a side bet wins or loses by the hidden piece, and the purse carries it', async () => {
    const db = await setup();
    // 'guardiana' is in her piece. Two stakes on the same word, opposite
    // sides: exactly one of them can win, and the piece decides which.
    assert.equal(await readPurse(db, 'player'), SIDE_BET.startPurse, 'a new purse is seeded');
    await placeWager(db, {
        roundId: String((await readOpenRound(db, 'player', DAY)).id), userId: 'player', locale: 'es', day: DAY,
        wordKey: 'guardiana', wordForm: 'guardiana', side: 'uses', stake: 2, odds: SIDE_BET.usesPays
    });
    await placeWager(db, {
        roundId: String((await readOpenRound(db, 'player', DAY)).id), userId: 'player', locale: 'es', day: DAY,
        wordKey: 'guardiana', wordForm: 'guardiana', side: 'absent', stake: 4, odds: SIDE_BET.absentPays
    });
    assert.equal(await readPurse(db, 'player'), SIDE_BET.startPurse - 6, 'stakes are charged as they are placed');

    const view = await lock(db, { ropes: ['padre'] });
    const wagered = view.wagers;
    assert.equal(wagered.length, 2);
    const won = wagered.find((wager) => wager.side === 'uses');
    const lost = wagered.find((wager) => wager.side === 'absent');
    assert.equal(won.status, 'won', 'she used it: the uses side collects');
    assert.equal(won.payout, 2 * SIDE_BET.usesPays);
    assert.equal(lost.status, 'lost', 'she used it: the absent side loses its stake');
    assert.equal(lost.payout, 0);
    const pot = potFor(countWords(SCENES.es.story));
    const expected = SIDE_BET.startPurse - 6 + pot + 2 * SIDE_BET.usesPays;
    assert.equal(view.purse, expected, 'the round banks its score and the wager pays out');
    assert.equal(await readPurse(db, 'player'), expected);
});

test('a round walked away from refunds its stakes', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    await addPrompt(db, DAY, 'es', 'The prompt of the day');
    await prepareDuel(db, fakeAi([SCENES.es.draft]), 'player', 'es', DAY);
    await placeWager(db, {
        roundId: String((await readOpenRound(db, 'player', DAY)).id), userId: 'player', locale: 'es', day: DAY,
        wordKey: 'guardiana', wordForm: 'guardiana', side: 'uses', stake: 3, odds: SIDE_BET.usesPays
    });
    assert.equal(await readPurse(db, 'player'), SIDE_BET.startPurse - 3);
    // A new day: the abandoned round is voided, the stake comes home.
    await addPrompt(db, '2026-11-24', 'es', 'The prompt of the day after.');
    await prepareDuel(db, fakeAi([SCENES.es.draft]), 'player', 'es', '2026-11-24');
    assert.equal(await readPurse(db, 'player'), SIDE_BET.startPurse, 'the stake was refunded');
    const old = db.rows(`SELECT status FROM duel_wagers`)[0].status;
    assert.equal(old, 'void');
});

test('hit words she smuggles into her rewrite pay the jailbreak dividend', async () => {
    const db = await setup();
    const before = await readPurse(db, 'player');
    await lock(db, { ropes: ['guardiana', 'gaviota', 'padre'] });
    const views = await rewriteUntilSettled(db, fakeAi([
        'La guardiana llamó a su padre.',
        'La guardiana esperó.',
        'La guardiana volvió.',
        'La guardiana estaba.'
    ]));
    const last = views.at(-1).rewrite;
    assert.equal(last.status, 'escaped');
    assert.deepEqual(last.violations, ['guardiana'], 'the best pass kept one hostage — a hit word, so it pays');
    const stored = await readLatestLocked(db, 'player', DAY);
    assert.equal(stored.hostage_bonus, SIDE_BET.jailbreakPays);
    assert.equal(await readPurse(db, 'player'), before + stored.score + SIDE_BET.jailbreakPays);
});

test('the streak counts consecutive days, ending today or yesterday', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    assert.equal(await readStreak(db, 'player', DAY), 0);
    // Two days back to back, none today: the streak holds.
    await addPrompt(db, '2026-11-22', 'es', 'P1.');
    await prepareDuel(db, fakeAi([SCENES.es.draft]), 'player', 'es', '2026-11-22');
    await lockDuel(db, fakeAi(), { userId: 'player', locale: 'es', day: '2026-11-22', story: SCENES.es.story, ropes: ['padre'] });
    await addPrompt(db, '2026-11-23', 'es', 'P2.');
    await prepareDuel(db, fakeAi([SCENES.es.draft]), 'player', 'es', DAY);
    await lockDuel(db, fakeAi(), { userId: 'player', locale: 'es', day: DAY, story: SCENES.es.story, ropes: ['padre'] });
    assert.equal(await readStreak(db, 'player', DAY), 2);
    // A gap breaks it.
    await addPrompt(db, '2026-11-20', 'es', 'P0.');
    await prepareDuel(db, fakeAi([SCENES.es.draft]), 'player', 'es', '2026-11-20');
    await lockDuel(db, fakeAi(), { userId: 'player', locale: 'es', day: '2026-11-20', story: SCENES.es.story, ropes: ['padre'] });
    assert.equal(await readStreak(db, 'player', DAY), 2, 'the older day is beyond the gap');
});

test('one round ends, another begins: no once-a-day, and every round its own piece', async () => {
    const db = await setup('es');
    const first = await lock(db);
    const second = await lockDuel(db, fakeAi([SCENES.es.draft]), {
        userId: 'player',
        locale: 'es',
        day: DAY,
        story: SCENES.es.story,
        ropes: ['padre']
    });
    assert.notEqual(second.id, first.id, 'a second lock is a second round, not a refusal');
    const drafts = db
        .rows('SELECT d.id FROM oulipo_duel_drafts d JOIN oulipo_duel_rounds r ON r.draft_id = d.id ORDER BY d.id')
        .map((row) => row.id);
    assert.equal(drafts.length, 2);
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'locked'`)[0].n, 2);
    // Each round keeps the piece it was judged against.
    const one = await readRoundById(db, String(first.id));
    const two = await readRoundById(db, String(second.id));
    assert.notEqual(one.draft_id, two.draft_id);
    // Another player locks the same day; another day, the same player.
    await addUser(db, 'other');
    await prepareDuel(db, fakeAi([SCENES.es.draft]), 'other', 'es', DAY);
    await lockDuel(db, fakeAi(), { userId: 'other', locale: 'es', day: DAY, story: SCENES.es.story, ropes: ['padre'] });
    await addPrompt(db, '2026-11-24', 'es', 'The prompt of the day after.');
    await prepareDuel(db, fakeAi([SCENES.es.draft]), 'player', 'es', '2026-11-24');
    await lockDuel(db, fakeAi(), { userId: 'player', locale: 'es', day: '2026-11-24', story: SCENES.es.story, ropes: ['padre'] });
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM oulipo_duel_rounds')[0].n, 4);
    assert.equal((await readLatestLocked(db, 'player', DAY)).id, second.id);
});

test('the same round cannot be locked twice, even asked at once', async () => {
    const db = await setup('es');
    const ask = () =>
        lockDuel(db, fakeAi(), {
            userId: 'player',
            locale: 'es',
            day: DAY,
            story: SCENES.es.story,
            ropes: ['padre']
        });
    const [winner, loser] = await Promise.allSettled([ask(), ask()]);
    const won = [winner, loser].filter((r) => r.status === 'fulfilled');
    const lost = [winner, loser].filter((r) => r.status === 'rejected');
    assert.equal(won.length, 1, 'exactly one of two racing locks scores');
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.code, 'already_locked');
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'locked'`)[0].n, 1);
});

test('lock does not score when the draft cannot be written', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    await addPrompt(db, DAY, 'es', 'Prompt.');
    await rejectsCode(lock(db), 503, 'draft_failed');
    assert.equal(db.rows(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE status = 'locked'`)[0].n, 0);
});

test("the duel keeps the site's day: the date in Mexico City", () => {
    assert.equal(duelDay(), getToday());
    assert.match(duelDay(), /^\d{4}-\d{2}-\d{2}$/);
});

// ── The rewrite ────────────────────────────────────────────────────────

const settled = (view) => view.rewrite.status === 'clean' || view.rewrite.status === 'escaped';

/** Ask for the rewrite until it settles. Returns every answer, in order. */
async function rewriteUntilSettled(db, ai) {
    const views = [];
    for (let request = 0; request < 12; request++) {
        const view = await rewriteDuel(db, ai, { userId: 'player', day: DAY });
        views.push(view);
        if (settled(view)) return views;
    }
    throw new Error('the rewrite never settled');
}

test('the rewrite forbids every sent word, hits and misses alike', async () => {
    const db = await setup();
    await lock(db, { ropes: ['guardiana', 'gaviota', 'padre'] });
    const ai = fakeAi(['Miraba el faro desde la torre.']);
    const view = await rewriteDuel(db, ai, { userId: 'player', day: DAY });
    assert.equal(ai.calls.length, 1);
    assert.equal(ai.calls[0].model, SAPPHO_MODEL);
    assert.equal(ai.calls[0].input.max_tokens, DUEL.maxRewriteTokens);
    const [system, task] = ai.calls[0].input.messages.map((message) => message.content);
    assert.ok(system.startsWith(SAPPHO_DUEL_PERSONAS.es), 'her own voice carries the rule');
    assert.ok(system.includes('guardiana, gaviotas, padre'));
    assert.ok(task.includes(SCENES.es.draft), 'she rewrites her own piece');
    assert.ok(task.includes('guardiana, gaviotas, padre'), 'misses are forbidden too');
    assert.deepEqual(view.rewrite, {
        status: 'clean',
        attempts: 1,
        violations: [],
        text: 'Miraba el faro desde la torre.',
        spans: []
    });
    const stored = await readLatestLocked(db, 'player', DAY);
    assert.equal(stored.rewrite_status, 'clean');
    assert.equal(stored.rewrite_attempts, 1);
    assert.equal(stored.rewrite_slipped, null);
});

test('every pass is a whole request, one pass per request, and progress is kept between them', async () => {
    const db = await setup();
    await lock(db, { ropes: ['guardiana', 'gaviota', 'padre'] });
    const ai = fakeAi([
        'La guardiana miraba el faro.', // keeps a forbidden word
        'Otra vez la guardiana.', // and again
        'Miraba el faro desde la torre.' // clean
    ]);
    const ask = () => rewriteDuel(db, ai, { userId: 'player', day: DAY });

    const first = await ask();
    assert.equal(ai.calls.length, 1, 'a request is one pass');
    assert.equal(first.rewrite.status, 'pending', 'not finished');
    assert.equal(first.rewrite.attempts, 1);
    assert.equal(first.rewrite.text, 'La guardiana miraba el faro.', 'the best so far is kept');
    let stored = await readLatestLocked(db, 'player', DAY);
    assert.equal(stored.rewrite_status, 'pending', 'the pen is given back between passes');
    assert.equal(stored.rewrite_slipped, '["guardiana"]');

    const second = await ask();
    assert.equal(ai.calls.length, 2);
    assert.equal(second.rewrite.status, 'pending');
    assert.equal(second.rewrite.attempts, 2);
    const third = await ask();
    assert.equal(third.rewrite.status, 'clean');
    assert.equal(third.rewrite.attempts, 3);
    assert.equal(third.rewrite.text, 'Miraba el faro desde la torre.');
    stored = await readLatestLocked(db, 'player', DAY);
    assert.equal(stored.rewrite_attempts, 3);
    assert.equal(stored.rewrite_slipped, null);

    // Each pass stands on its own: the piece, the whole list, and from the
    // second pass on the words that got through the last time.
    for (const [index, call] of ai.calls.entries()) {
        assert.equal(call.input.messages.length, 2, `pass ${index + 1}: system and user, no history`);
        const [system, task] = call.input.messages.map((message) => message.content);
        assert.ok(system.includes('guardiana, gaviotas, padre'), `pass ${index + 1}: the rule lists every word`);
        assert.ok(task.includes(SCENES.es.draft), `pass ${index + 1}: the piece travels with the request`);
        assert.ok(task.includes('guardiana, gaviotas, padre'), `pass ${index + 1}: the task lists every word`);
        assert.equal(task.includes('intento anterior'), index > 0, `pass ${index + 1}: only a retry mentions the last one`);
    }
    assert.ok(ai.calls[1].input.messages[1].content.includes('guardiana'), 'the retry names what got through');
    assert.equal((await ask()).rewrite.status, 'clean', 'a settled rewrite is simply returned');
    assert.equal(ai.calls.length, 3, 'and costs no further pass');
});

test('a pass that follows a closed tab picks up where the last one stopped', async () => {
    const db = await setup();
    await lock(db, { ropes: ['guardiana', 'padre'] });
    await rewriteDuel(db, fakeAi(['La guardiana llamó a su padre.']), { userId: 'player', day: DAY });
    // Nothing is held in memory between requests: a new one reads the round.
    const later = fakeAi(['La guardiana esperó.', 'Miraba el faro.']);
    await rewriteDuel(db, later, { userId: 'player', day: DAY });
    const note = later.calls[0].input.messages[1].content;
    assert.ok(note.includes(SCENES.es.draft) && note.includes('guardiana, padre'), 'still a whole request');
    assert.ok(note.includes('guardiana') && note.includes('padre') && note.includes('intento anterior'), 'and told what slipped before');
    const views = await rewriteUntilSettled(db, later);
    assert.equal(views.at(-1).rewrite.attempts, 3);
});

test('the rewrite catches another form of a sent word', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    await addPrompt(db, DAY, 'es', 'The prompt of the day');
    await prepareDuel(db, fakeAi(['Una casa en la colina.']), 'player', 'es', DAY);
    await lockDuel(db, fakeAi(), {
        userId: 'player',
        locale: 'es',
        day: DAY,
        story: `Mi casa tiene tejas rojas ${'palabra '.repeat(DUEL.minStoryWords).trim()}`,
        ropes: ['casa']
    });
    const ai = fakeAi(['Vi unas casas.', 'Vi una colina.']);
    const views = await rewriteUntilSettled(db, ai);
    assert.equal(ai.calls.length, 2, 'the plural was caught and retried');
    assert.ok(ai.calls[1].input.messages[1].content.includes('casas'));
    assert.deepEqual(
        views.map((view) => [view.rewrite.status, view.rewrite.attempts]),
        [['pending', 1], ['clean', 2]]
    );
    assert.equal(views.at(-1).rewrite.text, 'Vi una colina.');
});

test('the rewrite keeps the best pass and reports what escaped', async () => {
    const db = await setup();
    await lock(db, { ropes: ['guardiana', 'padre', 'gaviota'] });
    const ai = fakeAi([
        'La guardiana, su padre y las gaviotas.', // three left
        'La guardiana llamó a su padre.', // two left
        'Las gaviotas cruzaron el cielo.', // one left
        'El padre miró las gaviotas y la guardiana.' // three again
    ]);
    const views = await rewriteUntilSettled(db, ai);
    assert.equal(ai.calls.length, DUEL.rewriteAttempts, 'one call per request, up to the limit');
    assert.deepEqual(
        views.map((view) => view.rewrite.status),
        ['pending', 'pending', 'pending', 'escaped']
    );
    const last = views.at(-1).rewrite;
    assert.equal(last.attempts, 4);
    assert.equal(last.text, 'Las gaviotas cruzaron el cielo.');
    assert.deepEqual(last.violations, ['gaviotas']);
    assert.deepEqual(wordsAt(last.text, last.spans), ['gaviotas']);
    assert.equal((await readLatestLocked(db, 'player', DAY)).rewrite_violations, '["gaviotas"]');
    assert.equal((await readLatestLocked(db, 'player', DAY)).rewrite_slipped, null);
});

test('a silent engine never uses up a pass, and the player can ask again', async () => {
    const db = await setup();
    await lock(db, { ropes: ['padre'] });
    const original = console.error;
    console.error = () => {};
    try {
        // Four requests, one call each: empty, a thrown error, empty, blank.
        const ai = fakeAi(['', new Error('gateway down'), '', '   ']);
        for (let request = 0; request < 4; request++) {
            await rejectsCode(rewriteDuel(db, ai, { userId: 'player', day: DAY }), 503, 'rewrite_failed');
            assert.equal(ai.calls.length, request + 1, 'a request is one call, never a loop');
            const stored = await readLatestLocked(db, 'player', DAY);
            assert.equal(stored.rewrite_status, 'pending', 'the round is not held');
            assert.equal(stored.rewrite_attempts, 0, 'and no pass was spent');
        }
    } finally {
        console.error = original;
    }
    const view = await rewriteDuel(db, fakeAi([SCENES.es.rewrite]), { userId: 'player', day: DAY });
    assert.deepEqual([view.rewrite.status, view.rewrite.attempts], ['clean', 1]);
});

test('an empty pass after a real one counts as a pass and keeps what she wrote', async () => {
    const db = await setup();
    await lock(db, { ropes: ['guardiana', 'padre'] });
    const original = console.error;
    console.error = () => {};
    try {
        const ai = fakeAi(['La guardiana miraba el faro.', '', 'Miraba el faro.']);
        const ask = () => rewriteDuel(db, ai, { userId: 'player', day: DAY });
        const first = await ask();
        const second = await ask();
        assert.deepEqual([first.rewrite.attempts, second.rewrite.attempts], [1, 2]);
        assert.equal(second.rewrite.text, 'La guardiana miraba el faro.', 'the best so far is kept through the empty pass');
        assert.equal((await readLatestLocked(db, 'player', DAY)).rewrite_slipped, '["guardiana"]', 'and so is what the next pass must avoid');
        const third = await ask();
        assert.deepEqual([third.rewrite.status, third.rewrite.attempts], ['clean', 3]);
    } finally {
        console.error = original;
    }
});

test('runRewrite works without a database and stops at the first clean pass', async () => {
    const ai = fakeAi(['A prose piece.', 'Clean now.', 'Never asked.']);
    const outcome = await runRewrite(ai, 'en', 'A piece of prose.', ['prose'], {
        policy: { verbs: 'strict' },
        bannedKeys: ['prose']
    });
    assert.deepEqual(outcome, { content: 'Clean now.', violations: [], attempts: 2 });
    assert.equal(ai.calls.length, 2, 'the third answer is never requested');
    const [system, task] = ai.calls[0].input.messages.map((message) => message.content);
    assert.ok(system.startsWith(SAPPHO_DUEL_PERSONAS.en), 'her own voice carries the rule');
    assert.ok(system.includes('prose'));
    assert.ok(task.includes('A piece of prose.') && task.includes('prose'));
    const retry = ai.calls[1].input.messages[1].content;
    assert.ok(retry.includes('A piece of prose.') && retry.includes('previous attempt'), 'a retry is a whole request too');
    // One script per language, with the same three parts.
    for (const lang of ['en', 'es', 'fr']) {
        assert.deepEqual(Object.keys(SAPPHO_REWRITE[lang]), ['rule', 'task', 'retryNote'], lang);
    }
});

test('the rewrite happens once however many tabs ask', async () => {
    const db = await setup();
    await lock(db, { ropes: ['padre'] });
    const lines = ['Otra versión del texto.', 'Otra más, sin nada.', 'Una tercera.'];
    const answers = lines.map((line) => fakeAi([line]));
    const quick = { pause: async () => {} };
    const views = await Promise.all(
        answers.map((ai) => rewriteDuel(db, ai, { userId: 'player', day: DAY, ...quick }))
    );
    // Exactly one tab made the pass; the others were told where things stand.
    const holder = answers.findIndex((ai) => ai.calls.length > 0);
    assert.ok(holder >= 0 && answers.filter((ai) => ai.calls.length > 0).length === 1, 'only one tab generates');
    for (const view of views) assert.ok(settled(view) || view.rewrite.status === 'writing', view.rewrite.status);
    assert.equal(views[holder].rewrite.text, lines[holder], 'whoever held the pen wrote it');
    // Afterwards the answer is read back, with no engine needed at all.
    const after = await rewriteDuel(db, null, { userId: 'player', day: DAY });
    assert.equal(after.rewrite.status, 'clean');
    assert.equal(after.rewrite.text, lines[holder]);
});

test('a request that loses the claim reports where things stand, and a hung claim can be taken over', async () => {
    const db = await setup();
    await lock(db, { ropes: ['padre'] });
    // A round left claimed by a request that died a minute ago is still the holder's...
    await db
        .prepare("UPDATE oulipo_duel_rounds SET rewrite_status = 'writing', updated_at = datetime('now', '-1 minute') WHERE user_id = 'player'")
        .bind()
        .run();
    const loser = await rewriteDuel(db, fakeAi(['Never used.']), { userId: 'player', day: DAY, pause: async () => {} });
    assert.equal(loser.rewrite.status, 'writing', 'still being written by someone else');
    assert.equal(loser.rewrite.text, '');
    // ...but a claim older than five minutes may be taken over.
    await db
        .prepare("UPDATE oulipo_duel_rounds SET updated_at = datetime('now', '-6 minutes') WHERE user_id = 'player'")
        .bind()
        .run();
    const taker = await rewriteDuel(db, fakeAi([SCENES.es.rewrite]), { userId: 'player', day: DAY });
    assert.equal(taker.rewrite.status, 'clean');
    assert.equal(taker.rewrite.text, SCENES.es.rewrite);
});

test('a broken engine never leaves a round claimed', async () => {
    const db = await setup();
    await lock(db, { ropes: ['padre'] });
    await rejectsCode(rewriteDuel(db, null, { userId: 'player', day: DAY }), 503, 'no_engine');
    assert.equal((await readLatestLocked(db, 'player', DAY)).rewrite_status, 'pending');
    const view = await rewriteDuel(db, fakeAi([SCENES.es.rewrite]), { userId: 'player', day: DAY });
    assert.equal(view.rewrite.status, 'clean');
});

test('a rewrite needs a locked duel', async () => {
    const db = new SqliteD1();
    await addUser(db, 'player');
    await rejectsCode(rewriteDuel(db, fakeAi(), { userId: 'player', day: DAY }), 404, 'no_round');
});

// ── Sappho's voice ─────────────────────────────────────────────────────

test("the duel asks Sappho for a shorter piece without touching her daily voice", () => {
    const starts = { en: 'Keep it between', es: 'Manténla entre', fr: 'Garde-la entre' };
    /** The persona without its sentence about length. */
    const voiceOnly = (persona, start) => {
        const at = persona.indexOf(start);
        assert.ok(at > 0, `no length sentence at "${start}"`);
        return persona.slice(0, at) + persona.slice(persona.indexOf('. ', at) + 1);
    };
    for (const [lang, start] of Object.entries(starts)) {
        const daily = SAPPHO_PERSONAS[lang];
        const duel = SAPPHO_DUEL_PERSONAS[lang];
        assert.match(daily, /250/, `${lang}: the daily length is the one she has always been given`);
        assert.match(duel, /180/, `${lang}: the duel asks for less`);
        assert.ok(!duel.includes('250'), lang);
        assert.equal(voiceOnly(duel, start), voiceOnly(daily, start), `${lang}: the same voice either way`);
    }
});

// ── The day's board ────────────────────────────────────────────────────

test('the board ranks by score, shows the name each member chose, and honours the opt-out', async () => {
    const db = new SqliteD1();
    for (const id of ['ana', 'boca', 'rio']) await addUser(db, id, { username: id });
    await addUser(db, 'pia', { username: 'pia', name: 'Pluma' });
    await addUser(db, 'shy', { username: 'shy', onBoard: 0 });
    await addPrompt(db, DAY, 'es', 'The prompt of the day');
    // Every player prepares a round of their own; the fixture piece is what
    // each of them locks against.
    const play = async (id, ropes) => {
        await prepareDuel(db, fakeAi([SCENES.es.draft]), id, 'es', DAY);
        return lockDuel(db, fakeAi(), { userId: id, locale: 'es', day: DAY, story: SCENES.es.story, ropes });
    };
    // pia plays twice: a four-word moon shot (3 hits, 1 miss), then a single
    // word — which, hitting, pays the whole pot and stands as her best.
    await play('pia', SCENES.es.ropes);
    await play('pia', ['guardiana']);
    await play('ana', ['guardiana']);
    await play('rio', ['gaviota']);
    await play('shy', ['padre']);

    const pot = potFor(countWords(SCENES.es.story));
    const moonShot = Math.round((3 * pot) / 4);
    const oneHit = pot;
    const piaBest = Math.max(moonShot, oneHit);
    const board = await getBoard(db, 'es', DAY, { userId: 'pia' });
    // shy asked not to appear on scoreboards, so shy does not, round or no round.
    // Three rounds tied at the pot; ties share the board, ordered within the
    // second by their ids, so the test compares them as a set.
    const rows = board.map((row) => [row.name, row.score, row.mine]);
    assert.deepEqual(
        [...rows].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
        [['Pluma', piaBest, true], ['ana', oneHit, false], ['rio', 0, false]]
    );
    assert.deepEqual([...board.map((row) => row.mine)].sort(), [false, false, true]);
    assert.ok(!JSON.stringify(board).includes('shy'), 'an opt-out is an opt-out');
    // The member's best round stands for them; the count of rounds rides along.
    const best = piaBest === oneHit
        ? { hits: 1, misses: 0, ropeCount: 1 }
        : { hits: 3, misses: 1, ropeCount: 4 };
    const pluma = board.find((row) => row.mine);
    assert.deepEqual(pluma, {
        id: pluma.id,
        mine: true,
        name: 'Pluma',
        score: piaBest,
        muzzlePct: pluma.muzzlePct,
        hits: best.hits,
        misses: best.misses,
        ropeCount: best.ropeCount,
        rounds: 2
    });
    assert.deepEqual(board.map((row) => row.rounds), [2, 1, 1]);
    // Ties go to the deeper muzzle; the board is per language and per day.
    assert.deepEqual(await getBoard(db, 'fr', DAY), []);
    assert.deepEqual(await getBoard(db, 'es', '2026-11-25'), []);
    assert.deepEqual(await getBoard(db, 'de', DAY), []);
    // A member who changes their mind appears again.
    await db.prepare('UPDATE "user" SET show_in_scoreboard = 1 WHERE id = ?').bind('shy').run();
    const after = (await getBoard(db, 'es', DAY)).map((row) => `${row.name}:${row.score}`);
    assert.deepEqual(after.slice(0, 3).sort(), [`Pluma:${piaBest}`, `ana:${oneHit}`, `shy:${oneHit}`]);
    assert.deepEqual(after.slice(3), ['rio:0']);
});

test('a board that cannot be read is empty rather than indiscreet', async () => {
    const db = new SqliteD1();
    await addPrompt(db, DAY, 'es', 'The prompt of the day');
    await prepareDuel(db, fakeAi([SCENES.es.draft]), 'ana', 'es', DAY);
    db.db.exec('DROP TABLE "user"');
    await lockDuel(db, fakeAi(), { userId: 'ana', locale: 'es', day: DAY, story: SCENES.es.story, ropes: ['padre'] });
    const original = console.error;
    console.error = () => {};
    try {
        assert.deepEqual(await getBoard(db, 'es', DAY), []);
    } finally {
        console.error = original;
    }
});

test('a request that loses the claim is told the winner answer, and a hung claim can be taken over', async () => {
    const db = await setup();
    await lock(db, { ropes: ['padre'] });
    // A round left claimed by a request that died a minute ago is still the winner's...
    await db.prepare("UPDATE oulipo_duel_rounds SET rewrite_status = 'writing', updated_at = datetime('now', '-1 minute') WHERE user_id = 'player'").bind().run();
    const loser = await rewriteDuel(db, fakeAi(['Never used.']), {
        userId: 'player',
        day: DAY,
        pause: async () => {},
        waitRounds: 3
    });
    assert.equal(loser.rewrite.status, 'writing', 'still being written by someone else');
    assert.equal(loser.rewrite.text, '');
    assert.equal(db.rows('SELECT rewrite_violations FROM oulipo_duel_rounds')[0].rewrite_violations, null);
    // ...but a claim older than five minutes may be taken over.
    await db.prepare("UPDATE oulipo_duel_rounds SET updated_at = datetime('now', '-6 minutes') WHERE user_id = 'player'").bind().run();
    const taker = await rewriteDuel(db, fakeAi([SCENES.es.rewrite]), { userId: 'player', day: DAY });
    assert.equal(taker.rewrite.status, 'clean');
    assert.equal(taker.rewrite.text, SCENES.es.rewrite);
});

test('a broken engine never leaves a round claimed', async () => {
    const db = await setup();
    await lock(db, { ropes: ['padre'] });
    await rejectsCode(rewriteDuel(db, null, { userId: 'player', day: DAY }), 503, 'no_engine');
    assert.equal((await readLatestLocked(db, 'player', DAY)).rewrite_status, 'pending');
    const view = await rewriteDuel(db, fakeAi([SCENES.es.rewrite]), { userId: 'player', day: DAY });
    assert.equal(view.rewrite.status, 'clean');
});

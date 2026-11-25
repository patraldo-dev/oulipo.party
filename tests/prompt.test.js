// The day's prompt: node --test tests/prompt.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { ensurePrompt, PROMPT_CHARS, PROMPT_MODEL, PromptError, readPrompt, writePrompt } from '../src/lib/server/daily-prompt.js';
import { prepareDuel, readDraft } from '../src/lib/server/oulipo-duel.js';
import { fakeAi, SqliteD1 } from './helpers.js';

const DAY = '2026-11-24';
const PROMPT = 'Write about a door left open on the last night of winter.';
const isRefused = (code) => (error) => error instanceof PromptError && error.code === code;

test('the first to ask has the model write the prompt, in the language asked for', async () => {
    const db = new SqliteD1();
    const ai = fakeAi([PROMPT]);
    const prompt = await ensurePrompt(db, ai, 'fr', DAY);
    assert.equal(prompt.prompt_text, PROMPT);
    assert.equal(typeof prompt.id, 'string');
    assert.equal(ai.calls.length, 1);
    assert.equal(ai.calls[0].model, PROMPT_MODEL);
    const [system, user] = ai.calls[0].input.messages;
    assert.ok(system.content.includes('French'), 'asked for French');
    assert.ok(system.content.includes('Output the prompt and nothing else'), 'asked for the prompt alone');
    assert.ok(/Theme: .+\. Tone: .+\. Form: .+\./.test(user.content), 'given a theme, a tone and a form');
    assert.equal((await readPrompt(db, DAY, 'fr')).prompt_text, PROMPT);
});

test("a prompt already written is everyone's, and the model is not asked again", async () => {
    const db = new SqliteD1();
    const first = await ensurePrompt(db, fakeAi([PROMPT]), 'es', DAY);
    const ai = fakeAi([]);
    const second = await ensurePrompt(db, ai, 'es', DAY);
    assert.deepEqual(second, first);
    assert.equal(ai.calls.length, 0);
    const silent = await ensurePrompt(db, null, 'es', DAY);
    assert.deepEqual(silent, first, 'even with no model at all');
});

test('a day has one prompt per language', async () => {
    const db = new SqliteD1();
    const en = await ensurePrompt(db, fakeAi([PROMPT]), 'en', DAY);
    const fr = await ensurePrompt(db, fakeAi(['Écris sur une porte restée ouverte, la dernière nuit de l’hiver.']), 'fr', DAY);
    assert.notEqual(en.prompt_text, fr.prompt_text);
    assert.equal((await ensurePrompt(db, fakeAi([]), 'fr', DAY)).prompt_text, fr.prompt_text);
    assert.equal(db.rows('SELECT COUNT(*) AS n FROM daily_prompts')[0].n, 2);
});

test('anything the model wraps around the prompt is taken off', async () => {
    const ai = fakeAi(['  "Écris sur une porte restée ouverte, la dernière nuit de l’hiver." (Write about a door.)  ']);
    assert.equal(await writePrompt(ai, 'fr'), 'Écris sur une porte restée ouverte, la dernière nuit de l’hiver.');
});

test('a prompt that is a fragment, an essay, or in another script is refused and never stored', async () => {
    const refused = [
        'Too short.',
        'x'.repeat(PROMPT_CHARS.max + 1),
        'Пишите о двери, которая осталась открытой в последнюю ночь зимы, долго и подробно.',
        ''
    ];
    for (const bad of refused) {
        const db = new SqliteD1();
        await assert.rejects(ensurePrompt(db, fakeAi([bad]), 'fr', DAY), isRefused('bad_prompt'));
        assert.equal(await readPrompt(db, DAY, 'fr'), null, 'nothing is stored');
    }
});

test('a model that fails is reported, and the next request tries again', async () => {
    const db = new SqliteD1();
    await assert.rejects(ensurePrompt(db, fakeAi([new Error('gateway down')]), 'en', DAY), isRefused('engine_failed'));
    assert.equal(await readPrompt(db, DAY, 'en'), null);
    assert.equal((await ensurePrompt(db, fakeAi([PROMPT]), 'en', DAY)).prompt_text, PROMPT);
});

test('with no model, a prompt that exists is served and a missing one is refused', async () => {
    const db = new SqliteD1();
    await ensurePrompt(db, fakeAi([PROMPT]), 'en', DAY);
    assert.equal((await ensurePrompt(db, null, 'en', DAY)).prompt_text, PROMPT);
    await assert.rejects(ensurePrompt(db, null, 'es', DAY), isRefused('no_engine'));
});

test('a prompt that cannot be written is the duel’s own failure, and nothing is drafted', async () => {
    const db = new SqliteD1();
    const original = console.error;
    console.error = () => {};
    try {
        await assert.rejects(
            prepareDuel(db, fakeAi([new Error('gateway down')]), 'es', DAY),
            (error) => error.code === 'prompt_failed' && error.status === 503 && error.detail === 'engine_failed'
        );
        await assert.rejects(prepareDuel(db, fakeAi(['Too short.']), 'es', DAY), (error) => error.code === 'prompt_failed');
        assert.equal(await readDraft(db, 'es', DAY), null, 'no draft without a prompt');
    } finally {
        console.error = original;
    }
});

// The Siege's server flow: node --test tests/siege.test.js
// A room, its players, a day's round and her rewrite, end to end on SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SIEGE, scoreSiege } from '../src/lib/oulipo/siege-rules.js';
import {
    createRoom,
    joinRoom,
    leaveRoom,
    lockSiege,
    prepareSiege,
    readEarlier,
    readSiege,
    rewriteSiege,
    siegeStatus,
    sitOut,
    stateOf
} from '../src/lib/server/siege.js';
import { DuelError, prepareDuel } from '../src/lib/server/oulipo-duel.js';
import { SCENES, SqliteD1, addPrompt, addUser, fakeAi } from './helpers.js';

// Days safely in the past, so that nothing here depends on the real clock.
const DAY = '2026-11-20';
const TOMORROW = '2026-11-21';
const PROMPT = 'You find an old map in a drawer, and one street on it is missing.';
const DRAFT = SCENES.en.draft;
const { story } = SCENES.en;
const lock = (db, userId, code, ropes = SCENES.en.ropes) =>
    lockSiege(db, fakeAi(), { userId, code, day: DAY, story, ropes });

/** A room with its players and its hidden piece, the day's prompt already written. */
async function room(players = ['ana', 'bo', 'cleo']) {
    const db = new SqliteD1();
    for (const id of players) addUser(db, id, { name: id.toUpperCase() });
    addPrompt(db, DAY, 'en', PROMPT);
    const started = await createRoom(db, { userId: players[0], locale: 'en', day: DAY });
    for (const id of players.slice(1)) await joinRoom(db, { userId: id, code: started.code, day: DAY });
    await prepareSiege(db, fakeAi([DRAFT]), { userId: players[0], code: started.code, day: DAY });
    return { db, code: started.code };
}

/** @param {Promise<unknown>} promise @param {number} status @param {string} code */
async function refuses(promise, status, code) {
    await assert.rejects(promise, (error) => error instanceof DuelError && error.status === status && error.code === code);
}

test('a room starts with a code of its own, in the starter’s language, and counts them in', async () => {
    const db = new SqliteD1();
    addUser(db, 'ana');
    const view = await createRoom(db, { userId: 'ana', locale: 'es', day: DAY });
    assert.match(view.code, new RegExp(`^[${SIEGE.codeAlphabet}]{${SIEGE.codeLength}}$`));
    assert.equal(view.locale, 'es');
    assert.equal(view.status, 'writing');
    assert.equal(view.you, 'writing');
    // Without a display name, the username stands in, as on the Duel's board.
    assert.deepEqual(view.players, [{ userId: 'ana', name: 'ana', locked: false, mine: true }]);
    assert.equal(view.result, null, 'nothing to show yet');
    await refuses(createRoom(db, { userId: 'ana', locale: 'xx', day: DAY }), 400, 'bad_language');
});

test('players enter with the code, as loosely as they may type it, and are counted in', async () => {
    const { db, code } = await room(['ana', 'bo']);
    const typed = ` ${code.toLowerCase().slice(0, 3)} ${code.toLowerCase().slice(3)} `;
    const view = await joinRoom(db, { userId: 'bo', code: typed, day: DAY });
    assert.equal(view.present, 2);
    assert.equal(view.locked, 0);
    assert.deepEqual(
        view.players.map((one) => [one.name, one.locked, one.mine]),
        [
            ['ANA', false, false],
            ['BO', false, true]
        ]
    );
    // Nothing of the hidden piece is in what a player sees before the end.
    assert.equal(JSON.stringify(view).includes(DRAFT.slice(0, 40)), false);
});

test('a wrong code is not a room, and codes cannot be searched for', async () => {
    const { db, code } = await room(['ana']);
    addUser(db, 'stranger');
    await refuses(joinRoom(db, { userId: 'stranger', code: 'AAAAA', day: DAY }), 404, 'no_room');
    await refuses(joinRoom(db, { userId: 'stranger', code: 'nonsense', day: DAY }), 404, 'no_room');
    // A member who is not in the room learns only enough to decide to join,
    // and that look is a try.
    const look = await readSiege(db, 'stranger', code, DAY);
    assert.equal(look?.view, null);
    assert.deepEqual(look?.preview, { locale: 'en', members: 1, full: false });
    for (let tries = 4; tries <= SIEGE.joinMissesPerDay; tries++) {
        await refuses(joinRoom(db, { userId: 'stranger', code: 'AAAAA', day: DAY }), 404, 'no_room');
    }
    await refuses(readSiege(db, 'stranger', code, DAY), 429, 'too_many_attempts');
    await refuses(joinRoom(db, { userId: 'stranger', code, day: DAY }), 429, 'too_many_attempts');
    assert.equal(await readSiege(db, 'stranger', 'AAAAA', DAY), null);
});

test('the room has a hidden piece of its own, never the site’s, and it stays hidden', async () => {
    const { db, code } = await room(['ana', 'bo']);
    const site = fakeAi(['The site’s own piece for the day, about a map.']);
    assert.equal((await prepareDuel(db, site, 'en', DAY)).draftReady, true);
    assert.equal(db.rows('SELECT content FROM siege_drafts')[0].content, DRAFT);
    assert.equal(db.rows('SELECT content FROM oulipo_duel_drafts')[0].content, 'The site’s own piece for the day, about a map.');
    const view = await stateOf(db, 'ana', code, DAY);
    assert.equal(view.prompt, PROMPT);
    assert.equal(view.promptReady, true);
    assert.equal(JSON.stringify(view).includes('lighthouse keeper watched'), false);
});

test('a piece and its words are checked again on the server, as in the Duel', async () => {
    const { db, code } = await room(['ana', 'bo']);
    const lockWith = (piece, ropes) => lockSiege(db, fakeAi(), { userId: 'ana', code, day: DAY, story: piece, ropes });
    await refuses(lockWith('', []), 400, 'story_missing');
    await refuses(lockWith('Too short a piece.', ['piece']), 400, 'story_too_short');
    await refuses(lockWith(story, ['wordnotthere']), 400, 'rope_not_in_story');
    await refuses(lockWith(story, []), 400, 'ropes_missing');
    await refuses(lockWith(story, 'lamp'), 400, 'ropes_missing');
    addUser(db, 'outsider');
    await refuses(lock(db, 'outsider', code), 403, 'not_a_member');
    await refuses(lock(db, 'ana', 'AAAAA'), 404, 'no_room');
    assert.equal((await stateOf(db, 'ana', code, DAY)).locked, 0, 'nothing of the above was kept');
});

test('the round resolves the moment the last player counted in locks', async () => {
    const { db, code } = await room();
    const first = await lock(db, 'ana', code, ['lighthouse', 'gull', 'lamp']);
    assert.equal(first.status, 'writing');
    assert.equal(first.you, 'locked');
    assert.equal(`${first.locked}/${first.present}`, '1/2');
    assert.equal(first.result, null, 'her piece is still nobody’s to read');

    const second = await lock(db, 'bo', code, ['lighthouse', 'gull']);
    assert.equal(second.status, 'writing', 'one player is still to lock');

    const third = await lock(db, 'cleo', code, ['lighthouse', 'father']);
    assert.equal(third.status, 'resolved');
    assert.equal(third.result?.players, 3);
    assert.equal(third.result?.unionSize, 4);

    // The same answer the rules give by hand.
    const byHand = scoreSiege({
        draft: DRAFT,
        locale: 'en',
        prompt: PROMPT,
        entries: [
            { userId: 'ana', story, ropes: ['lighthouse', 'gull', 'lamp'] },
            { userId: 'bo', story, ropes: ['lighthouse', 'gull'] },
            { userId: 'cleo', story, ropes: ['lighthouse', 'father'] }
        ]
    });
    const [ana, bo, cleo] = byHand.players;
    assert.deepEqual(
        third.result?.table.map((row) => [row.name, row.rank, row.score, row.mine]),
        [
            ['CLEO', 1, cleo.score, true],
            ['ANA', 2, ana.score, false],
            ['BO', 3, bo.score, false]
        ]
    );
    assert.deepEqual(
        third.result?.mine?.ropes.map((rope) => [rope.key, rope.tag]),
        [
            ['lighthouse', 'unanimous'],
            ['father', 'original']
        ]
    );
    const piece = third.result?.draft;
    assert.ok(piece, 'her piece is shown now that it is over');
    assert.equal(piece.text.startsWith('The lighthouse keeper watched'), true);
    const marked = piece.spans.map((span) => piece.text.slice(span.start, span.end));
    assert.deepEqual(marked.sort(), ['father', 'lamp', 'lighthouse'], 'everyone’s hits are marked in it');
    assert.deepEqual(
        db.rows('SELECT user_id, score FROM siege_entries ORDER BY user_id').map((row) => [row.user_id, row.score]),
        [
            ['ana', ana.score],
            ['bo', bo.score],
            ['cleo', cleo.score]
        ]
    );

    // Another player is shown the same table, and only their own words.
    const forBo = await stateOf(db, 'bo', code, DAY);
    assert.deepEqual(
        forBo.result?.table.map((row) => row.score),
        third.result?.table.map((row) => row.score)
    );
    assert.deepEqual(forBo.result?.mine?.ropes.map((rope) => rope.key), ['lighthouse', 'gull']);
    assert.equal(JSON.stringify(forBo.result?.mine).includes('lamp'), false, 'ana’s words are ana’s');
});

test('a word locked is locked: a second lock is refused', async () => {
    const { db, code } = await room(['ana', 'bo']);
    await lock(db, 'ana', code);
    await refuses(lock(db, 'ana', code), 409, 'already_locked');
    await refuses(sitOut(db, { userId: 'ana', code, day: DAY }), 409, 'already_locked');
    await refuses(leaveRoom(db, { userId: 'ana', code, day: DAY }), 409, 'already_locked');
    assert.equal((await stateOf(db, 'ana', code, DAY)).locked, 1);
});

test('sitting out takes a player out of the day’s count, and the rest go on', async () => {
    const { db, code } = await room();
    const out = await sitOut(db, { userId: 'bo', code, day: DAY });
    assert.equal(out.you, 'out');
    assert.equal(out.present, 2, 'ana and cleo are still counted in');
    await lock(db, 'ana', code);
    assert.equal((await stateOf(db, 'cleo', code, DAY)).status, 'writing');
    const done = await lock(db, 'cleo', code);
    assert.equal(done.status, 'resolved', 'two locked, and nobody else is counted in');
    assert.deepEqual(
        done.result?.table.map((row) => row.name).sort(),
        ['ANA', 'CLEO']
    );
    assert.equal((await stateOf(db, 'bo', code, DAY)).you, 'late');
});

test('sitting out is for the day: opening the room again counts the player back in', async () => {
    const { db, code } = await room();
    await sitOut(db, { userId: 'bo', code, day: DAY });
    assert.equal((await stateOf(db, 'bo', code, DAY)).you, 'writing');
    assert.equal((await stateOf(db, 'bo', code, DAY)).present, 3);
});

test('one player alone is no siege: the day ends and the round lapses', async () => {
    const { db, code } = await room(['ana', 'bo']);
    await sitOut(db, { userId: 'bo', code, day: DAY });
    const alone = await lock(db, 'ana', code);
    assert.equal(alone.status, 'writing', 'waiting for somebody else');
    const nextDay = await stateOf(db, 'ana', code, TOMORROW);
    assert.equal(nextDay.status, 'writing', 'a new day, a new round');
    assert.equal(nextDay.you, 'writing');
    assert.deepEqual(nextDay.earlier, [{ date: DAY, status: 'lapsed', score: null }]);
    assert.equal(db.rows('SELECT status FROM siege_rounds WHERE duel_date = ?', DAY)[0].status, 'lapsed');
});

test('when the day ends with enough locked, the round resolves with those who did', async () => {
    const { db, code } = await room();
    await lock(db, 'ana', code);
    await lock(db, 'bo', code);
    assert.equal(db.rows('SELECT status FROM siege_rounds WHERE duel_date = ?', DAY)[0].status, 'writing', 'cleo is still counted in');

    const cleoSees = await stateOf(db, 'cleo', code, TOMORROW);
    assert.equal(db.rows('SELECT status FROM siege_rounds WHERE duel_date = ?', DAY)[0].status, 'resolved');
    assert.deepEqual(cleoSees.earlier, [{ date: DAY, status: 'resolved', score: null }], 'cleo never locked, so has no score');
    assert.equal((await stateOf(db, 'ana', code, TOMORROW)).earlier[0].score !== null, true);

    // Yesterday is there to be read, in full, by anyone who was in the room.
    const yesterday = await readEarlier(db, 'ana', code, DAY);
    assert.equal(yesterday?.status, 'resolved');
    assert.deepEqual(
        yesterday?.result?.table.map((row) => row.name).sort(),
        ['ANA', 'BO']
    );
    assert.equal(await readEarlier(db, 'ana', code, TOMORROW), null, 'not a day that is over');
    assert.equal(await readEarlier(db, 'ana', code, '2026-11-19'), null, 'not a day in this room');
});

test('a late arrival finds the day’s siege over, and can read it but not join it', async () => {
    const { db, code } = await room(['ana', 'bo']);
    await lock(db, 'ana', code);
    await lock(db, 'bo', code);
    addUser(db, 'late');
    const view = await joinRoom(db, { userId: 'late', code, day: DAY });
    assert.equal(view.you, 'late');
    assert.equal(view.result?.mine, null);
    assert.equal(view.result?.players, 2);
    await refuses(lock(db, 'late', code), 409, 'already_resolved');
});

test('a room holds so many and no more; and a member only so many rooms a day', async () => {
    const nine = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    const { db, code } = await room(nine.slice(0, SIEGE.maxPlayers));
    await refuses(joinRoom(db, { userId: nine[8], code, day: DAY }), 409, 'room_full');
    assert.equal((await readSiege(db, nine[8], code, DAY))?.preview?.full, true);

    const other = new SqliteD1();
    addUser(other, 'ana');
    for (let started = 0; started < SIEGE.startsPerDay; started++) {
        await createRoom(other, { userId: 'ana', locale: 'en', day: DAY });
    }
    await refuses(createRoom(other, { userId: 'ana', locale: 'en', day: DAY }), 429, 'too_many_starts');
    assert.equal((await createRoom(other, { userId: 'ana', locale: 'en', day: TOMORROW })).status, 'writing', 'tomorrow is another day');
});

test('leaving a room is for good, and no longer holds the others back', async () => {
    const { db, code } = await room();
    await leaveRoom(db, { userId: 'cleo', code, day: DAY });
    assert.equal((await readSiege(db, 'cleo', code, DAY))?.view, null, 'no longer in the room');
    await lock(db, 'ana', code);
    const done = await lock(db, 'bo', code);
    assert.equal(done.status, 'resolved');
});

test('the landing page learns which sieges are open, and which wait for the member', async () => {
    const { db, code } = await room(['ana', 'bo']);
    assert.deepEqual(await siegeStatus(db, 'ana', DAY), { open: 1, waiting: 0 });
    await lock(db, 'bo', code);
    assert.deepEqual(await siegeStatus(db, 'ana', DAY), { open: 1, waiting: 1 }, 'bo has locked, and waits for ana');
    await lock(db, 'ana', code);
    assert.deepEqual(await siegeStatus(db, 'ana', DAY), { open: 0, waiting: 0 }, 'nothing under way once resolved');
});

test('she rewrites against everyone’s words, one pass per request, and the best pass is kept', async () => {
    const { db, code } = await room(['ana', 'bo']);
    await lock(db, 'ana', code, ['lighthouse', 'gull', 'lamp']);
    await lock(db, 'bo', code, ['lighthouse', 'father']);
    // Her first pass keeps "father"; her second avoids every word.
    const ai = fakeAi([SCENES.en.rewrite.replace('a voice she knew.', "her father's quiet voice."), SCENES.en.rewrite]);

    const first = await rewriteSiege(db, ai, { userId: 'ana', code, day: DAY });
    assert.equal(first.result?.rewrite.status, 'pending');
    assert.equal(first.result?.rewrite.attempts, 1);
    assert.deepEqual(first.result?.rewrite.violations, ['father']);
    const slipped = first.result?.rewrite;
    assert.ok(slipped);
    assert.deepEqual(slipped.spans.map((span) => slipped.text.slice(span.start, span.end)), ['father'], 'the word that got through is marked');

    const second = await rewriteSiege(db, ai, { userId: 'bo', code, day: DAY });
    assert.equal(second.result?.rewrite.status, 'clean');
    assert.equal(second.result?.rewrite.attempts, 2);
    assert.equal(second.result?.rewrite.text.startsWith('The keeper watched the water.'), true);

    // Both players' words were in what she was told to avoid.
    const told = ai.calls[0].input.messages.map((message) => message.content).join('\n').toLowerCase();
    for (const word of ['lighthouse', 'gulls', 'lamp', 'father']) assert.ok(told.includes(word), word);
    await rewriteSiege(db, ai, { userId: 'ana', code, day: DAY });
    assert.equal(ai.calls.length, 2, 'a settled round is never asked again');
    await refuses(rewriteSiege(db, ai, { userId: 'ana', code: 'AAAAA', day: DAY }), 404, 'no_room');
});

test('a silent engine never uses up a pass, and leaves no claim behind', async () => {
    const { db, code } = await room(['ana', 'bo']);
    await lock(db, 'ana', code);
    await lock(db, 'bo', code);
    await refuses(rewriteSiege(db, fakeAi(['', '']), { userId: 'ana', code, day: DAY }), 503, 'rewrite_failed');
    const round = db.rows('SELECT rewrite_status, rewrite_attempts FROM siege_rounds')[0];
    assert.equal(round.rewrite_status, 'pending');
    assert.equal(round.rewrite_attempts, 0);
    const fine = fakeAi([SCENES.en.rewrite]);
    assert.equal((await rewriteSiege(db, fine, { userId: 'ana', code, day: DAY })).result?.rewrite.status, 'clean');
});

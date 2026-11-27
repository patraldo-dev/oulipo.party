// src/lib/server/siege.js
// The Siege.
//
// A room is entered with a code, and keeps that code from day to day. Each
// day it has one round. Everyone who opens the room that day is counted in
// until they lock, sit out, or the day ends. Each player writes a piece and
// locks words as in the Duel. When all who are counted in have locked, every
// locked word goes against one hidden piece of Sappho's, and the round is
// scored (src/lib/oulipo/siege-rules.js). She then rewrites against them all.
//
// The room's hidden piece is its own, never the site's piece for that day:
// anyone who had played the Duel would already know every hit.
//
// Everything here takes `db` and `ai` as arguments and imports nothing from
// the runtime, so the whole flow runs under node:test against SQLite.
// Before a round resolves, nobody's words leave the server and neither does
// the hidden piece: both are returned by viewOf(), once it has.
/** @typedef {import('#lib/oulipo/types.js').Lang} Lang */
/** @typedef {import('#lib/oulipo/types.js').Policy} Policy */
/** @typedef {import('#lib/oulipo/types.js').Row} Row */
/** @typedef {import('#lib/oulipo/types.js').Db} Db */
/** @typedef {import('#lib/oulipo/types.js').Engine} Engine */
/** @typedef {import('#lib/oulipo/types.js').ScoredRope} ScoredRope */
/** @typedef {import('#lib/oulipo/types.js').SiegePlayer} SiegePlayer */
/** @typedef {import('#lib/oulipo/types.js').SiegeView} SiegeView */

import { analyze, defaultPolicy, isLang, markText, normalizeText } from '#lib/oulipo/engine.js';
import { SIEGE, isCode, newCode, normalizeCode, scoreSiege, siegeTable } from '#lib/oulipo/siege-rules.js';
import { ensurePrompt, PromptError, readPrompt } from './daily-prompt.js';
import { generateDraft } from './oulipo-sappho.js';
import { SAPPHO_MODEL } from './sappho-persona.js';
import {
    CLAIM_MINUTES,
    LOOK_MS,
    DuelError,
    defaultPause,
    duelDay,
    nextRewritePass,
    parseJson,
    validateStory
} from './oulipo-duel.js';

/** The game's day, as every function here counts it unless given one. */
const today = () => duelDay();

/** @param {unknown} error */
const reason = (error) => (error instanceof Error ? error.message : String(error));
/** @param {unknown} error */
const isUniqueError = (error) => error instanceof Error && /unique/i.test(error.message);
/** @param {Row} row A round whose rewrite is finished. */
const isSettled = (row) => row.rewrite_status !== 'pending' && row.rewrite_status !== 'writing';

// ── Reading ────────────────────────────────────────────────────────────

/** @param {Db} db @param {string} code */
const roomByCode = (db, code) => db.prepare('SELECT * FROM siege_rooms WHERE code = ?').bind(code).first();
/** @param {Db} db @param {string} id */
const roundById = (db, id) => db.prepare('SELECT * FROM siege_rounds WHERE id = ?').bind(id).first();
/** @param {Db} db @param {string} roomId @param {string} day */
const roundOf = (db, roomId, day) =>
    db.prepare('SELECT * FROM siege_rounds WHERE room_id = ? AND duel_date = ?').bind(roomId, day).first();
/** @param {Db} db @param {string} roundId */
const draftOf = (db, roundId) => db.prepare('SELECT * FROM siege_drafts WHERE round_id = ?').bind(roundId).first();
/** @param {Db} db @param {string} roomId @param {string} userId */
const isMember = async (db, roomId, userId) =>
    Boolean(await db.prepare('SELECT 1 FROM siege_members WHERE room_id = ? AND user_id = ?').bind(roomId, userId).first());
/** @param {Db} db @param {string} roomId */
const memberCount = async (db, roomId) =>
    Number((await db.prepare('SELECT COUNT(*) AS n FROM siege_members WHERE room_id = ?').bind(roomId).first())?.n ?? 0);
/** @param {Db} db @param {string} userId */
const roomsIn = async (db, userId) =>
    Number((await db.prepare('SELECT COUNT(*) AS n FROM siege_members WHERE user_id = ?').bind(userId).first())?.n ?? 0);
/** @param {Db} db @param {string} userId @param {string} day */
const roomsStartedOn = async (db, userId, day) =>
    Number(
        (
            await db
                .prepare('SELECT COUNT(*) AS n FROM siege_rooms WHERE created_by = ? AND start_day = ?')
                .bind(userId, day)
                .first()
        )?.n ?? 0
    );
/** How many are counted in for a round and have not locked. @param {Db} db @param {string} roundId */
const waitingIn = async (db, roundId) =>
    Number(
        (
            await db
                .prepare('SELECT COUNT(*) AS n FROM siege_entries WHERE round_id = ? AND present = 1 AND locked_at IS NULL')
                .bind(roundId)
                .first()
        )?.n ?? 0
    );
/** How many have locked in a round. @param {Db} db @param {string} roundId */
const lockedIn = async (db, roundId) =>
    Number(
        (
            await db
                .prepare('SELECT COUNT(*) AS n FROM siege_entries WHERE round_id = ? AND locked_at IS NOT NULL')
                .bind(roundId)
                .first()
        )?.n ?? 0
    );

/**
 * A round's entries, each under the name its player goes by: those who have
 * locked in the order they locked, then those still writing by name. (Their
 * times are kept to the second, so they would not do to order them by.)
 * @param {Db} db @param {string} roundId
 */
async function entriesOf(db, roundId) {
    const { results } = await db
        .prepare(
            `SELECT e.*, u.username, u.name
               FROM siege_entries e
               JOIN "user" u ON u.id = e.user_id
              WHERE e.round_id = ?
              ORDER BY (e.locked_at IS NULL), e.locked_at, COALESCE(u.name, u.username) COLLATE NOCASE, e.id`
        )
        .bind(roundId)
        .all();
    return results ?? [];
}

/** @param {Row} entry */
const nameOf = (entry) => entry.name || entry.username || '·';

/**
 * Count a look at a room the member is not in. A code cannot be searched
 * for: after SIEGE.joinMissesPerDay in a day, the answer is only "enough".
 * @param {Db} db @param {string} userId @param {string} day
 */
async function countMiss(db, userId, day) {
    await db
        .prepare(
            `INSERT INTO siege_join_misses (user_id, miss_date, misses) VALUES (?, ?, 1)
             ON CONFLICT (user_id, miss_date) DO UPDATE SET misses = misses + 1`
        )
        .bind(userId, day)
        .run();
    const row = await db
        .prepare('SELECT misses FROM siege_join_misses WHERE user_id = ? AND miss_date = ?')
        .bind(userId, day)
        .first();
    if (Number(row?.misses ?? 0) > SIEGE.joinMissesPerDay) throw new DuelError(429, 'too_many_attempts');
}

/**
 * The room a code names, and a check that the member is in it.
 * @param {Db} db @param {string} userId @param {unknown} code
 * @returns {Promise<Row>}
 */
async function memberRoom(db, userId, code) {
    const wanted = normalizeCode(code);
    const room = isCode(wanted) ? await roomByCode(db, wanted) : null;
    if (!room) throw new DuelError(404, 'no_room');
    if (!(await isMember(db, room.id, userId))) throw new DuelError(403, 'not_a_member');
    return room;
}

// ── Opening a room ─────────────────────────────────────────────────────

/**
 * The room's round for a day, made the first time anyone opens the room
 * that day. Opening the room counts the player in for the day's siege,
 * unless the round is over.
 * @param {Db} db @param {Row} room @param {string} userId @param {string} day
 * @returns {Promise<Row>}
 */
async function openToday(db, room, userId, day) {
    let round = await roundOf(db, room.id, day);
    if (!round) {
        try {
            await db
                .prepare('INSERT INTO siege_rounds (id, room_id, locale, duel_date) VALUES (?, ?, ?, ?)')
                .bind(crypto.randomUUID(), room.id, room.locale, day)
                .run();
        } catch (error) {
            // Two players opened the room at once: the round that won the
            // race is the day's. Anything else is worth hearing about.
            if (!isUniqueError(error)) throw error;
        }
        round = await roundOf(db, room.id, day);
        if (!round) throw new DuelError(503, 'no_round');
    }
    if (round.status === 'writing') {
        await db
            .prepare(
                `INSERT INTO siege_entries (id, round_id, user_id, present) VALUES (?, ?, ?, 1)
                 ON CONFLICT (round_id, user_id)
                 DO UPDATE SET present = 1, updated_at = datetime('now')
                  WHERE siege_entries.locked_at IS NULL`
            )
            .bind(crypto.randomUUID(), round.id, userId)
            .run();
    }
    return round;
}

// ── The room's hidden piece ────────────────────────────────────────────

/**
 * The room's own hidden piece for its round, written the first time it is
 * asked for. The day's prompt is the site's; the piece is the room's.
 * @param {Db} db @param {Engine} ai @param {Row} round
 * @returns {Promise<Row>}
 */
async function ensureRoomDraft(db, ai, round) {
    const existing = await draftOf(db, round.id);
    if (existing) return existing;

    const locale = /** @type {Lang} */ (round.locale);
    let prompt;
    try {
        prompt = await ensurePrompt(db, ai, locale, round.duel_date);
    } catch (error) {
        if (error instanceof PromptError) {
            console.error('[siege] prompt failed:', reason(error));
            throw new DuelError(503, 'prompt_failed', error.code);
        }
        throw error;
    }
    const content = await generateDraft(ai, locale, prompt.prompt_text);
    const id = crypto.randomUUID();
    try {
        await db
            .prepare('INSERT INTO siege_drafts (id, round_id, prompt_id, prompt_text, content, model) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(id, round.id, prompt.id, prompt.prompt_text, content, SAPPHO_MODEL)
            .run();
        await db.prepare('UPDATE siege_rounds SET draft_id = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(id, round.id).run();
        return { id, round_id: round.id, prompt_id: prompt.id, prompt_text: prompt.prompt_text, content, model: SAPPHO_MODEL };
    } catch (error) {
        // Two players asked at once: the piece that won the race is the round's.
        if (!isUniqueError(error)) throw error;
        const winner = await draftOf(db, round.id);
        if (!winner) throw error;
        return winner;
    }
}

// ── Resolving a round ──────────────────────────────────────────────────

/**
 * Score a round whose day is over, or whose players have all locked, and
 * keep what her rewrite will need. With fewer than SIEGE.minPlayers locked
 * a round only lapses, and only once its day is over.
 * @param {Db} db @param {string} roundId @param {boolean} [dayOver]
 */
async function resolveRound(db, roundId, dayOver = false) {
    const round = await roundById(db, roundId);
    if (!round || round.status !== 'writing') return;
    const locked = (await entriesOf(db, roundId)).filter((entry) => entry.locked_at);
    if (locked.length < SIEGE.minPlayers) {
        if (!dayOver) return;
        await db
            .prepare(
                `UPDATE siege_rounds SET status = 'lapsed', resolved_at = datetime('now'), updated_at = datetime('now')
                  WHERE id = ? AND status = 'writing'`
            )
            .bind(roundId)
            .run();
        return;
    }

    const draft = await draftOf(db, roundId);
    if (!draft) throw new DuelError(503, 'draft_missing');
    const locale = /** @type {Lang} */ (round.locale);
    const score = scoreSiege({
        draft: draft.content,
        locale,
        prompt: draft.prompt_text,
        entries: locked.map((entry) => ({
            userId: entry.user_id,
            story: String(entry.story ?? ''),
            ropes: /** @type {string[]} */ (parseJson(entry.ropes, []))
        }))
    });
    for (const player of score.players) {
        const entry = locked.find((one) => one.user_id === player.userId);
        await db
            .prepare(
                `UPDATE siege_entries
                    SET hits = ?, misses = ?, original = ?, unanimous = ?, bonus = ?, score = ?, verdict = ?,
                        updated_at = datetime('now')
                  WHERE id = ?`
            )
            .bind(
                player.hits,
                player.misses,
                player.original,
                player.unanimous,
                player.bonus,
                player.score,
                JSON.stringify({ ropes: player.ropes, storyTypes: player.storyTypes }),
                entry?.id
            )
            .run();
    }
    await db
        .prepare(
            `UPDATE siege_rounds
                SET status = 'resolved', players = ?, union_size = ?, union_keys = ?, union_forms = ?,
                    muzzle_pct = ?, resolved_at = datetime('now'), updated_at = datetime('now')
              WHERE id = ? AND status = 'writing'`
        )
        .bind(
            score.players.length,
            score.union.keys.length,
            JSON.stringify(score.union.keys),
            JSON.stringify(score.union.forms),
            score.muzzlePct,
            roundId
        )
        .run();
}

/**
 * Resolve a round if nobody counted in is still to lock, and enough have.
 * @param {Db} db @param {Row} round
 */
async function settleIfReady(db, round) {
    if (round.status !== 'writing') return;
    if ((await waitingIn(db, round.id)) > 0) return;
    if ((await lockedIn(db, round.id)) >= SIEGE.minPlayers) await resolveRound(db, round.id);
}

/** Resolve the room's rounds from earlier days, whose day has ended. @param {Db} db @param {string} roomId @param {string} day */
async function settlePast(db, roomId, day) {
    const { results } = await db
        .prepare(`SELECT id FROM siege_rounds WHERE room_id = ? AND status = 'writing' AND duel_date < ? ORDER BY duel_date`)
        .bind(roomId, day)
        .all();
    for (const row of results ?? []) await resolveRound(db, String(row.id), true);
}

// ── What a player may see ──────────────────────────────────────────────

/**
 * The result of a resolved round, as one player sees it: how they did with
 * every word tagged, the room's table, her piece with everyone's hits
 * marked, and her rewrite.
 * @param {Db} db @param {Row} round @param {Row[]} locked @param {string} userId
 * @param {Lang} locale @param {Policy} policy
 */
async function resultOf(db, round, locked, userId, locale, policy) {
    /** @type {{ entry: Row, player: SiegePlayer }[]} */
    const scored = locked.map((entry) => {
        /** @type {{ ropes?: ScoredRope[], storyTypes?: number }} */
        const verdict = parseJson(entry.verdict, {});
        const ropes = /** @type {ScoredRope[]} */ (Array.isArray(verdict?.ropes) ? verdict.ropes : []);
        return {
            entry,
            player: {
                userId: entry.user_id,
                ropes,
                hits: Number(entry.hits),
                misses: Number(entry.misses),
                original: Number(entry.original),
                unanimous: Number(entry.unanimous),
                bonus: Number(entry.bonus),
                score: Number(entry.score),
                storyTypes: Number(verdict?.storyTypes ?? ropes.length)
            }
        };
    });
    const table = siegeTable(
        { players: scored.map((one) => one.player), union: { keys: [], forms: [] }, muzzlePct: Number(round.muzzle_pct ?? 0) },
        locked.map((entry) => ({ userId: entry.user_id, name: nameOf(entry) })),
        userId
    );
    const draft = await draftOf(db, round.id);
    const draftText = normalizeText(draft?.content ?? '');
    const rewriteText = normalizeText(round.rewrite ?? '');
    return {
        players: scored.length,
        unionSize: Number(round.union_size ?? 0),
        muzzlePct: Number(round.muzzle_pct ?? 0),
        mine: scored.find((one) => one.entry.user_id === userId)?.player ?? null,
        table,
        draft: {
            text: draftText,
            // Anyone's hit is marked: between them, this is what they put off-limits.
            spans: draft ? markText(draftText, scored.flatMap((one) => one.player.ropes.filter((rope) => rope.hit).map((rope) => rope.key)), locale, policy) : []
        },
        rewrite: {
            status: round.rewrite_status,
            attempts: Number(round.rewrite_attempts ?? 0),
            violations: /** @type {string[]} */ (parseJson(round.rewrite_violations, [])),
            text: rewriteText,
            // What slipped through is marked.
            spans: rewriteText ? markText(rewriteText, /** @type {string[]} */ (parseJson(round.union_keys, [])), locale, policy) : []
        }
    };
}

/**
 * What one player may see of a room. Before the round resolves that is who
 * is in and whether they have locked, never a word of theirs, and never
 * the hidden piece.
 * @param {Db} db @param {Row} room @param {string} userId @param {string} day
 * @param {Row | null} [known] The day's round, if it has been read already.
 * @returns {Promise<SiegeView>}
 */
async function viewOf(db, room, userId, day, known) {
    const round = known !== undefined ? known : await roundOf(db, room.id, day);
    const entries = round ? await entriesOf(db, round.id) : [];
    const locked = entries.filter((entry) => entry.locked_at);
    const mine = entries.find((entry) => entry.user_id === userId) ?? null;
    const over = Boolean(round) && round?.status !== 'writing';
    const prompt = await readPrompt(db, day, /** @type {Lang} */ (room.locale));

    /** @type {SiegeView} */
    const view = {
        code: room.code,
        locale: /** @type {Lang} */ (room.locale),
        date: day,
        status: round?.status ?? 'writing',
        you: !mine ? (over ? 'late' : 'none') : mine.locked_at ? 'locked' : over ? 'late' : mine.present ? 'writing' : 'out',
        prompt: prompt?.prompt_text ?? '',
        promptReady: Boolean(prompt),
        locked: locked.length,
        present: entries.filter((entry) => entry.present && !entry.locked_at).length,
        players: entries
            .filter((entry) => entry.locked_at || (entry.present && !over))
            .map((entry) => ({ userId: entry.user_id, name: nameOf(entry), locked: Boolean(entry.locked_at), mine: entry.user_id === userId })),
        result: null,
        earlier: []
    };
    if (round?.status === 'resolved') {
        view.result = await resultOf(db, round, locked, userId, view.locale, defaultPolicy(view.locale));
    }
    const { results } = await db
        .prepare(
            `SELECT r.duel_date, r.status, e.score
               FROM siege_rounds r
               LEFT JOIN siege_entries e ON e.round_id = r.id AND e.user_id = ?
              WHERE r.room_id = ? AND r.duel_date < ? AND r.status <> 'writing'
              ORDER BY r.duel_date DESC
              LIMIT 7`
        )
        .bind(userId, room.id, day)
        .all();
    view.earlier = (results ?? []).map((row) => ({
        date: String(row.duel_date),
        status: row.status === 'resolved' ? 'resolved' : 'lapsed',
        score: row.score === null || row.score === undefined ? null : Number(row.score)
    }));
    return view;
}

// ── What the pages and the endpoints call ──────────────────────────────

/**
 * Start a room, in the member's language, and count them in for today.
 * @param {Db} db @param {{ userId: string, locale: unknown, day?: string }} input
 * @returns {Promise<SiegeView>}
 */
export async function createRoom(db, { userId, locale, day = today() }) {
    if (!isLang(locale)) throw new DuelError(400, 'bad_language', String(locale));
    if ((await roomsIn(db, userId)) >= SIEGE.roomsPerMember) throw new DuelError(429, 'too_many_rooms');
    if ((await roomsStartedOn(db, userId, day)) >= SIEGE.startsPerDay) throw new DuelError(429, 'too_many_starts');

    const id = crypto.randomUUID();
    let made = false;
    for (let attempt = 0; attempt < 8 && !made; attempt++) {
        try {
            await db
                .prepare('INSERT INTO siege_rooms (id, code, locale, created_by, start_day) VALUES (?, ?, ?, ?, ?)')
                .bind(id, newCode(), locale, userId, day)
                .run();
            made = true;
        } catch (error) {
            // A code already taken. So unlikely that a few tries are plenty.
            if (attempt === 7 || !isUniqueError(error)) throw error;
        }
    }
    if (!made) throw new DuelError(503, 'no_code');
    await db.prepare('INSERT INTO siege_members (room_id, user_id) VALUES (?, ?)').bind(id, userId).run();
    const room = /** @type {Row} */ (await db.prepare('SELECT * FROM siege_rooms WHERE id = ?').bind(id).first());
    await openToday(db, room, userId, day);
    return viewOf(db, room, userId, day);
}

/**
 * Enter a room with its code, and count the member in for today. A code
 * that is nobody's is not told apart from a room the member is not in.
 * @param {Db} db @param {{ userId: string, code: unknown, day?: string }} input
 * @returns {Promise<SiegeView>}
 */
export async function joinRoom(db, { userId, code, day = today() }) {
    const wanted = normalizeCode(code);
    const room = isCode(wanted) ? await roomByCode(db, wanted) : null;
    const member = room ? await isMember(db, room.id, userId) : false;
    if (!room || !member) await countMiss(db, userId, day);
    if (!room) throw new DuelError(404, 'no_room');
    if (!member) {
        if ((await memberCount(db, room.id)) >= SIEGE.maxPlayers) throw new DuelError(409, 'room_full');
        if ((await roomsIn(db, userId)) >= SIEGE.roomsPerMember) throw new DuelError(429, 'too_many_rooms');
        await db.prepare('INSERT INTO siege_members (room_id, user_id) VALUES (?, ?)').bind(room.id, userId).run();
    }
    const round = await openToday(db, room, userId, day);
    return viewOf(db, room, userId, day, round);
}

/**
 * What a member may see of a room, read only: a page's first paint, before
 * it has asked to be counted in. A member who is not in the room learns only
 * enough to decide to join, and that look counts as a try.
 * @param {Db} db @param {string} userId @param {unknown} code @param {string} [day]
 * @returns {Promise<{ view: SiegeView | null, preview: { locale: Lang, members: number, full: boolean } | null } | null>}
 */
export async function readSiege(db, userId, code, day = today()) {
    const wanted = normalizeCode(code);
    const room = isCode(wanted) ? await roomByCode(db, wanted) : null;
    if (!room) return null;
    if (await isMember(db, room.id, userId)) return { view: await viewOf(db, room, userId, day), preview: null };
    await countMiss(db, userId, day);
    const members = await memberCount(db, room.id);
    return { view: null, preview: { locale: /** @type {Lang} */ (room.locale), members, full: members >= SIEGE.maxPlayers } };
}

/**
 * The room as it stands, once the page has asked: earlier days are settled,
 * the member is counted in for today, and today's round is resolved if it
 * is ready.
 * @param {Db} db @param {string} userId @param {unknown} code @param {string} [day]
 * @returns {Promise<SiegeView>}
 */
export async function stateOf(db, userId, code, day = today()) {
    const room = await memberRoom(db, userId, code);
    await settlePast(db, room.id, day);
    const round = await openToday(db, room, userId, day);
    await settleIfReady(db, round);
    return viewOf(db, room, userId, day);
}

/**
 * Make sure the day's prompt and the room's hidden piece exist. Returns
 * what a player may know before locking: the prompt, and that the piece is
 * ready. Never the piece.
 * @param {Db} db @param {Engine | null | undefined} ai
 * @param {{ userId: string, code: unknown, day?: string }} input
 * @returns {Promise<{ prompt: { id: string | null, text: string }, draftReady: boolean }>}
 */
export async function prepareSiege(db, ai, { userId, code, day = today() }) {
    const room = await memberRoom(db, userId, code);
    const round = await roundOf(db, room.id, day);
    if (!round) throw new DuelError(404, 'no_round');
    let draft;
    if (round.status !== 'writing') {
        draft = await draftOf(db, round.id);
    } else {
        if (!ai) throw new DuelError(503, 'no_engine');
        try {
            draft = await ensureRoomDraft(db, ai, round);
        } catch (error) {
            if (error instanceof DuelError) throw error;
            console.error('[siege] draft failed:', reason(error));
            throw new DuelError(503, 'draft_failed', reason(error));
        }
    }
    return {
        prompt: { id: draft?.prompt_id ?? null, text: draft?.prompt_text ?? '' },
        draftReady: Boolean(draft)
    };
}

/**
 * Lock a player's words for the day. The piece and the words are checked
 * again here, whatever the page sent. When this was the last player counted
 * in, the round resolves here and now.
 * @param {Db} db @param {Engine | null | undefined} ai
 * @param {{ userId: string, code: unknown, day?: string, story: unknown, ropes: unknown }} input
 * @returns {Promise<SiegeView>}
 */
export async function lockSiege(db, ai, { userId, code, day = today(), story, ropes }) {
    const room = await memberRoom(db, userId, code);
    const round = await roundOf(db, room.id, day);
    if (!round) throw new DuelError(404, 'no_round');
    if (round.status !== 'writing') throw new DuelError(409, 'already_resolved');
    const mine = await db.prepare('SELECT locked_at FROM siege_entries WHERE round_id = ? AND user_id = ?').bind(round.id, userId).first();
    if (mine?.locked_at) throw new DuelError(409, 'already_locked');

    const locale = /** @type {Lang} */ (room.locale);
    const policy = defaultPolicy(locale);
    validateStory(story);
    if (!Array.isArray(ropes)) throw new DuelError(400, 'ropes_missing');
    const available = new Set(analyze(story, locale, policy).types.map((type) => type.key));
    const wanted = [...new Set(ropes)];
    const invalid = wanted.filter((key) => typeof key !== 'string' || !available.has(key));
    if (invalid.length) throw new DuelError(400, 'rope_not_in_story', invalid.slice(0, 10).join(', '));
    if (!wanted.length) throw new DuelError(400, 'ropes_missing');

    try {
        await ensureRoomDraft(db, /** @type {Engine} */ (ai), round);
    } catch (error) {
        if (error instanceof DuelError) throw error;
        console.error('[siege] draft failed:', reason(error));
        throw new DuelError(503, 'draft_failed', reason(error));
    }

    const saved = await db
        .prepare(
            `INSERT INTO siege_entries (id, round_id, user_id, present, story, policy, ropes, rope_count, story_types, locked_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT (round_id, user_id)
             DO UPDATE SET present = 1, story = excluded.story, policy = excluded.policy, ropes = excluded.ropes,
                           rope_count = excluded.rope_count, story_types = excluded.story_types,
                           locked_at = datetime('now'), updated_at = datetime('now')
              WHERE siege_entries.locked_at IS NULL`
        )
        .bind(crypto.randomUUID(), round.id, userId, story, JSON.stringify(policy), JSON.stringify(wanted), wanted.length, available.size)
        .run();
    // Someone else's tab locked first, or this word was already in.
    if (saved.meta?.changes !== 1) throw new DuelError(409, 'already_locked');

    await settleIfReady(db, round);
    return viewOf(db, room, userId, day);
}

/**
 * Sit out today's siege: no longer counted in, and the round may resolve
 * without this player. Only while there is nothing locked.
 * @param {Db} db @param {{ userId: string, code: unknown, day?: string }} input
 * @returns {Promise<SiegeView>}
 */
export async function sitOut(db, { userId, code, day = today() }) {
    const room = await memberRoom(db, userId, code);
    const round = await roundOf(db, room.id, day);
    if (round?.status === 'writing') {
        const mine = await db
            .prepare('SELECT locked_at FROM siege_entries WHERE round_id = ? AND user_id = ?')
            .bind(round.id, userId)
            .first();
        if (mine?.locked_at) throw new DuelError(409, 'already_locked');
        await db
            .prepare("UPDATE siege_entries SET present = 0, updated_at = datetime('now') WHERE round_id = ? AND user_id = ? AND locked_at IS NULL")
            .bind(round.id, userId)
            .run();
        await settleIfReady(db, round);
    }
    return viewOf(db, room, userId, day, round ?? null);
}

/**
 * Leave a room for good. A player who has already locked today stays in
 * today's result; they can leave tomorrow.
 * @param {Db} db @param {{ userId: string, code: unknown, day?: string }} input
 */
export async function leaveRoom(db, { userId, code, day = today() }) {
    const room = await memberRoom(db, userId, code);
    const round = await roundOf(db, room.id, day);
    if (round?.status === 'writing') {
        const mine = await db
            .prepare('SELECT locked_at FROM siege_entries WHERE round_id = ? AND user_id = ?')
            .bind(round.id, userId)
            .first();
        if (mine?.locked_at) throw new DuelError(409, 'already_locked');
        await db.prepare('DELETE FROM siege_entries WHERE round_id = ? AND user_id = ?').bind(round.id, userId).run();
    }
    await db.prepare('DELETE FROM siege_members WHERE room_id = ? AND user_id = ?').bind(room.id, userId).run();
    if (round) await settleIfReady(db, round);
}

/**
 * Make one pass at the rewrite of a resolved round, or return it as it
 * stands. The same rules as the Duel's rewrite: a request makes at most one
 * pass, exactly one request holds the pen, progress is stored after every
 * pass, and a claim left hanging may be taken over after CLAIM_MINUTES.
 * What she must avoid is every word any player sent.
 * @param {Db} db @param {Engine | null | undefined} ai
 * @param {{ userId: string, code: unknown, day?: string, pause?: (ms: number) => Promise<void> }} input
 * @returns {Promise<SiegeView>}
 */
export async function rewriteSiege(db, ai, { userId, code, day = today(), pause = defaultPause }) {
    const room = await memberRoom(db, userId, code);
    const round = await roundOf(db, room.id, day);
    if (!round || round.status !== 'resolved') throw new DuelError(404, 'no_round');
    const again = async () => viewOf(db, room, userId, day);
    if (isSettled(round)) return again();

    const draft = await draftOf(db, round.id);
    if (!draft) throw new DuelError(503, 'draft_missing');
    const claim = await db
        .prepare(
            `UPDATE siege_rounds
                SET rewrite_status = 'writing', updated_at = datetime('now')
              WHERE id = ?
                AND (rewrite_status = 'pending'
                     OR (rewrite_status = 'writing' AND updated_at < datetime('now', ?)))`
        )
        .bind(round.id, `-${CLAIM_MINUTES} minutes`)
        .run();
    if (claim.meta?.changes !== 1) {
        // Someone else holds the pen: give their pass a moment, then report.
        await pause(LOOK_MS);
        return again();
    }
    const release = () =>
        db
            .prepare("UPDATE siege_rounds SET rewrite_status = 'pending' WHERE id = ? AND rewrite_status = 'writing'")
            .bind(round.id)
            .run();
    if (!ai) {
        await release();
        throw new DuelError(503, 'no_engine');
    }

    const locale = /** @type {Lang} */ (round.locale);
    const next = await nextRewritePass(ai, {
        locale,
        policy: defaultPolicy(locale),
        draft: draft.content,
        forbidden: /** @type {string[]} */ (parseJson(round.union_forms, [])),
        bannedKeys: /** @type {string[]} */ (parseJson(round.union_keys, [])),
        slipped: /** @type {string[]} */ (parseJson(round.rewrite_slipped, [])),
        soFar: {
            content: round.rewrite || '',
            violations: /** @type {string[]} */ (parseJson(round.rewrite_violations, [])),
            attempts: Number(round.rewrite_attempts) || 0
        }
    });
    // Nothing has come back yet, in any pass: the round stays as it was,
    // the claim goes back, and a player can ask again. A silent engine
    // never uses up a pass.
    if (!next) {
        await release();
        throw new DuelError(503, 'rewrite_failed');
    }
    await db
        .prepare(
            `UPDATE siege_rounds
                SET rewrite = ?, rewrite_status = ?, rewrite_attempts = ?, rewrite_violations = ?,
                    rewrite_slipped = ?, updated_at = datetime('now')
              WHERE id = ? AND rewrite_status = 'writing'`
        )
        .bind(
            next.content,
            next.status,
            next.attempts,
            JSON.stringify(next.violations),
            next.slipped ? JSON.stringify(next.slipped) : null,
            round.id
        )
        .run();
    return again();
}

/**
 * An earlier day's result, read only, for a member of the room.
 * @param {Db} db @param {string} userId @param {unknown} code @param {unknown} date
 * @returns {Promise<SiegeView | null>} null when there is no such day in the room
 */
export async function readEarlier(db, userId, code, date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today()) return null;
    const room = await memberRoom(db, userId, code);
    const round = await roundOf(db, room.id, date);
    if (!round || round.status === 'writing') return null;
    return viewOf(db, room, userId, date, round);
}

/**
 * For the landing page: of the member's rooms with a round under way today,
 * how many count the member in, and how many of those have someone already
 * locked and waiting for them.
 * @param {Db} db @param {string} userId @param {string} [day]
 * @returns {Promise<{ open: number, waiting: number }>}
 */
export async function siegeStatus(db, userId, day = today()) {
    const { results } = await db
        .prepare(
            `SELECT e.locked_at,
                    (SELECT COUNT(*) FROM siege_entries o WHERE o.round_id = r.id AND o.locked_at IS NOT NULL) AS locked
               FROM siege_members m
               JOIN siege_rounds r ON r.room_id = m.room_id AND r.duel_date = ? AND r.status = 'writing'
               JOIN siege_entries e ON e.round_id = r.id AND e.user_id = m.user_id AND e.present = 1
              WHERE m.user_id = ?`
        )
        .bind(day, userId)
        .all();
    const open = results ?? [];
    return {
        open: open.length,
        waiting: open.filter((row) => !row.locked_at && Number(row.locked) > 0).length
    };
}

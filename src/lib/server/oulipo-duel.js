// src/lib/server/oulipo-duel.js
// The solitaire duel, in rounds.
//
// The day's prompt is one per language (daily-prompt.js). A round is: prepare
// — Sappho writes a fresh hidden piece for it against that prompt — then the
// member writes a piece of their own, sends some of its words against hers,
// and scores the ones her piece actually used. No limit but a daily
// safeguard: play again and she writes again. She then rewrites her piece
// without the sent words, and every hit word she smuggles back pays its
// jailbreak dividend. The round's score is banked to the member's purse,
// which stakes side bets on the next round's hidden piece.
//
// Everything here takes `db` and `ai` as arguments and imports nothing from
// the runtime, so the whole flow runs under node:test against SQLite.
// A round's hidden piece is only ever returned by roundView(), after a lock.
// How Sappho herself is asked to write lives next door (oulipo-sappho.js);
// how she grades a piece's craft, in sappho-craft.js; the purse and its
// wagers, in purse.js.
/** @typedef {import('#lib/oulipo/types.js').Lang} Lang */
/** @typedef {import('#lib/oulipo/types.js').Policy} Policy */
/** @typedef {import('#lib/oulipo/types.js').Rope} Rope */
/** @typedef {import('#lib/oulipo/types.js').Row} Row */
/** @typedef {import('#lib/oulipo/types.js').Db} Db */
/** @typedef {import('#lib/oulipo/types.js').Engine} Engine */
/** @typedef {import('#lib/oulipo/types.js').RoundView} RoundView */
/** @typedef {import('#lib/oulipo/types.js').BoardRow} BoardRow */

import {
    analyze,
    countWords,
    defaultPolicy,
    isLang,
    judge,
    markText,
    normalizeText,
    tierFor
} from '#lib/oulipo/engine.js';
import {
    DUEL,
    SIDE_BET,
    contractName,
    contractPays,
    potFor,
    wagerScore
} from '#lib/oulipo/duel-rules.js';
import { ensurePrompt, PromptError } from './daily-prompt.js';
import { betterAttempt, generateDraft, rewritePass } from './oulipo-sappho.js';
import { gradeCraft } from './sappho-craft.js';
import { addPurse, readRoundWagers, settleWagers, voidWagers } from './purse.js';
import { SAPPHO_MODEL } from './sappho-persona.js';
import { getToday } from './day.js';

/** Thrown for anything the API turns into an error response. */
export class DuelError extends Error {
    /**
     * @param {number} status
     * @param {string} code
     * @param {string | null} [detail]
     */
    constructor(status, code, detail) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'DuelError';
        this.status = status;
        this.code = code;
        this.detail = detail || null;
    }
}

// The duel shares the site's day (day.js): the Mexico City date.
export const duelDay = getToday;

/**
 * A stored JSON column, or `fallback` when it is missing or damaged.
 * @template T
 * @param {unknown} text
 * @param {T} fallback
 * @returns {T}
 */
export function parseJson(text, fallback) {
    try {
        const value = JSON.parse(/** @type {string} */ (text));
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

/** @param {unknown} error */
const reason = (error) => (error instanceof Error ? error.message : String(error));

// ── Reads ──────────────────────────────────────────────────────────────

/** @param {Db} db @param {string} id @returns {Promise<Row | null>} */
export function readDraftById(db, id) {
    return db.prepare('SELECT * FROM oulipo_duel_drafts WHERE id = ?').bind(id).first();
}

/** A round's own hidden piece. @param {Db} db @param {string} roundId */
function readRoundDraft(db, roundId) {
    return db.prepare('SELECT * FROM oulipo_duel_drafts WHERE round_id = ?').bind(roundId).first();
}

/** The round the member is writing now, if there is one. */
export function readOpenRound(/** @type {Db} */ db, /** @type {string} */ userId, /** @type {string} */ day) {
    return db
        .prepare(
            `SELECT * FROM oulipo_duel_rounds
              WHERE user_id = ? AND duel_date = ? AND status = 'writing'
              ORDER BY created_at DESC, id DESC LIMIT 1`
        )
        .bind(userId, day)
        .first();
}

/** The round the member last locked today — the result panel shows it. */
export function readLatestLocked(/** @type {Db} */ db, /** @type {string} */ userId, /** @type {string} */ day) {
    return db
        .prepare(
            `SELECT * FROM oulipo_duel_rounds
              WHERE user_id = ? AND duel_date = ? AND status = 'locked'
              ORDER BY locked_at DESC, rowid DESC LIMIT 1`
        )
        .bind(userId, day)
        .first();
}

/** @param {Db} db @param {string} id @returns {Promise<Row | null>} */
export function readRoundById(db, id) {
    return db.prepare('SELECT * FROM oulipo_duel_rounds WHERE id = ?').bind(id).first();
}

/** How many rounds the member has locked today. */
function readLockedCount(/** @type {Db} */ db, /** @type {string} */ userId, /** @type {string} */ day) {
    return /** @type {PromiseLike<number>} */ (
        db
            .prepare(`SELECT COUNT(*) AS n FROM oulipo_duel_rounds WHERE user_id = ? AND duel_date = ? AND status = 'locked'`)
            .bind(userId, day)
            .first()
            .then((row) => Number(row?.n ?? 0))
    );
}

/**
 * The member's day streak: consecutive days, ending today or yesterday, with
 * at least one locked round. Derived, never stored.
 * @param {Db} db @param {string} userId @param {string} day
 * @returns {Promise<number>}
 */
export async function readStreak(db, userId, day) {
    const { results } = await db
        .prepare(
            `SELECT DISTINCT duel_date FROM oulipo_duel_rounds
              WHERE user_id = ? AND status = 'locked' ORDER BY duel_date DESC LIMIT 400`
        )
        .bind(userId)
        .all();
    const days = new Set((results ?? []).map((row) => String(row.duel_date)));
    const ms = (/** @type {string} */ d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    const back = (/** @type {string} */ d, /** @type {number} */ n) => {
        const t = new Date(ms(d) - n * 86400000);
        return t.toISOString().slice(0, 10);
    };
    // Today counts only once a round is locked today; yesterday always can.
    let cursor = days.has(day) ? day : back(day, 1);
    if (!days.has(cursor)) return 0;
    let streak = 0;
    while (days.has(cursor)) {
        streak++;
        cursor = back(cursor, 1);
    }
    return streak;
}

/**
 * Today's prompt for a language, if it already exists.
 * @param {Db} db @param {string} day @param {string} locale
 * @returns {Promise<{ id: string, prompt_text: string } | null>}
 */
export function readPrompt(db, day, locale) {
    return /** @type {Promise<{ id: string, prompt_text: string } | null>} */ (
        db.prepare('SELECT id, prompt_text FROM daily_prompts WHERE prompt_date = ? AND locale = ?').bind(day, locale).first()
    );
}

/**
 * The day's prompt, and a prompt that cannot be had reported in the duel's
 * own terms.
 * @param {Db} db @param {Engine | null | undefined} ai @param {Lang} locale @param {string} day
 * @returns {Promise<{ id: string, prompt_text: string }>}
 */
async function ensureTodayPrompt(db, ai, locale, day) {
    try {
        return await ensurePrompt(db, ai, locale, day);
    } catch (error) {
        if (error instanceof PromptError) {
            console.error('[duel] prompt failed:', reason(error));
            throw new DuelError(503, 'prompt_failed', error.code);
        }
        throw error;
    }
}

// ── The hidden piece ───────────────────────────────────────────────────

/**
 * The round's own hidden piece, written the first time it is asked for. Two
 * requests preparing the same round at once: the unique index settles it,
 * and the piece that won the race is the round's.
 * @param {Db} db @param {Engine} ai @param {Row} round @param {Lang} locale @param {string} day
 * @returns {Promise<Row>}
 */
async function ensureRoundDraft(db, ai, round, locale, day) {
    const existing = await readRoundDraft(db, String(round.id));
    if (existing) return existing;

    const prompt = await ensureTodayPrompt(db, ai, locale, day);
    const content = await generateDraft(ai, locale, prompt.prompt_text);
    /** @type {Row} */
    const row = {
        id: crypto.randomUUID(),
        locale,
        duel_date: day,
        prompt_id: prompt.id,
        prompt_text: prompt.prompt_text,
        content,
        model: SAPPHO_MODEL,
        round_id: String(round.id)
    };
    try {
        await db
            .prepare(
                `INSERT INTO oulipo_duel_drafts (id, locale, duel_date, prompt_id, prompt_text, content, model, round_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(row.id, row.locale, row.duel_date, row.prompt_id, row.prompt_text, row.content, row.model, row.round_id)
            .run();
        await db.prepare('UPDATE oulipo_duel_rounds SET draft_id = ? WHERE id = ?').bind(row.id, String(round.id)).run();
        round.draft_id = row.id;
        return row;
    } catch (error) {
        // Two requests at once: the piece that won the race is the round's.
        const winner = await readRoundDraft(db, String(round.id));
        if (winner) return winner;
        throw error;
    }
}

/**
 * Prepare a round for the member: reuse the one they are writing, or make a
 * fresh one with its own hidden piece. Open rounds left over from earlier
 * days are voided — their wagers refunded, their empty rows removed. Returns
 * what a player may know before locking: the prompt, that the piece is
 * ready, and the round's id.
 * @param {Db} db
 * @param {Engine | null | undefined} ai
 * @param {string} userId
 * @param {unknown} locale
 * @param {string} day
 * @returns {Promise<{ prompt: { id: string | null, text: string }, draftReady: boolean, roundId: string }>}
 */
export async function prepareDuel(db, ai, userId, locale, day) {
    if (!isLang(locale)) throw new DuelError(400, 'bad_language', String(locale));
    if (!ai) throw new DuelError(503, 'no_engine');

    // Walked away from an earlier day's round? Its stakes come back.
    const { results: stale } = await db
        .prepare(`SELECT id, user_id FROM oulipo_duel_rounds WHERE user_id = ? AND status = 'writing' AND duel_date < ?`)
        .bind(userId, day)
        .all();
    for (const row of stale ?? []) {
        await voidWagers(db, String(row.id), String(row.user_id));
        await db.prepare('DELETE FROM oulipo_duel_rounds WHERE id = ?').bind(String(row.id)).run();
    }

    try {
        const open = await readOpenRound(db, userId, day);
        if (open) {
            const draft = await ensureRoundDraft(db, ai, open, /** @type {Lang} */ (locale), day);
            return { prompt: { id: draft.prompt_id ?? null, text: draft.prompt_text }, draftReady: true, roundId: String(open.id) };
        }
    } catch (error) {
        if (error instanceof DuelError) throw error;
        console.error('[duel] draft failed:', reason(error));
        throw new DuelError(503, 'draft_failed', reason(error));
    }

    if ((await readLockedCount(db, userId, day)) >= DUEL.roundsPerDay) {
        throw new DuelError(429, 'round_limit', `${DUEL.roundsPerDay} rounds a day`);
    }

    /** @type {Row} */
    const round = {
        id: crypto.randomUUID(),
        user_id: userId,
        locale: /** @type {Lang} */ (locale),
        duel_date: day,
        draft_id: null,
        story: '',
        policy: '{}',
        ropes: '[]',
        rope_count: 0,
        story_types: 0,
        hits: 0,
        misses: 0,
        score: 0,
        muzzle_pct: 0,
        draft_tokens: 0
    };
    await db
        .prepare(
            `INSERT INTO oulipo_duel_rounds
               (id, user_id, locale, duel_date, draft_id, story, policy, ropes, rope_count,
                story_types, hits, misses, score, muzzle_pct, draft_tokens, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'writing')`
        )
        .bind(
            round.id, round.user_id, round.locale, round.duel_date, round.draft_id, round.story, round.policy,
            round.ropes, round.rope_count, round.story_types, round.hits, round.misses, round.score,
            round.muzzle_pct, round.draft_tokens
        )
        .run();
    try {
        const draft = await ensureRoundDraft(db, ai, round, /** @type {Lang} */ (locale), day);
        return { prompt: { id: draft.prompt_id ?? null, text: draft.prompt_text }, draftReady: true, roundId: round.id };
    } catch (error) {
        if (error instanceof DuelError) throw error;
        console.error('[duel] draft failed:', reason(error));
        throw new DuelError(503, 'draft_failed', reason(error));
    }
}

// ── Locking a round ────────────────────────────────────────────────────

/**
 * A piece as the server will take it: the rules of the Duel, and of the
 * Siege with them. Throws a DuelError saying which rule it broke.
 * @param {unknown} story
 */
export function validateStory(story) {
    if (typeof story !== 'string' || !story.trim()) {
        throw new DuelError(400, 'story_missing');
    }
    if (story.length > DUEL.maxStoryChars) {
        throw new DuelError(400, 'story_too_long', `${story.length} chars`);
    }
    const words = countWords(story);
    if (words < DUEL.minStoryWords) {
        throw new DuelError(400, 'story_too_short', `${words} words`);
    }
    if (words > DUEL.maxStoryWords) {
        throw new DuelError(400, 'story_too_long', `${words} words`);
    }
}

/**
 * A round as the player sees it — the only place the hidden piece leaves the
 * server. Texts come back in the exact form the spans index. `purse` is the
 * member's balance when the view is made, when anyone cared to pass it.
 * @param {Db} db @param {Row} row @param {Row} draft @param {{ purse?: number | null }} [extra]
 * @returns {Promise<RoundView>}
 */
export async function roundView(db, row, draft, { purse = null } = {}) {
    const locale = /** @type {Lang} */ (row.locale);
    const policy = /** @type {Policy} */ (parseJson(row.policy, { verbs: 'strict' }));
    const draftText = normalizeText(draft.content);
    const rewriteText = normalizeText(row.rewrite);
    const ropes = /** @type {Rope[]} */ (parseJson(row.ropes, []));
    const ropeKeys = ropes.map((rope) => rope.key);
    const pot = potFor(countWords(row.story));
    return {
        id: row.id,
        date: row.duel_date,
        locale,
        policy,
        story: row.story,
        ropes,
        ropeCount: row.rope_count,
        storyTypes: row.story_types,
        hits: row.hits,
        misses: row.misses,
        score: row.score,
        pot,
        pays: contractPays(row.rope_count, pot),
        craft: row.craft === null || row.craft === undefined ? null : Number(row.craft),
        jailbreak: row.hostage_bonus === null || row.hostage_bonus === undefined ? null : Number(row.hostage_bonus),
        wagers: (await readRoundWagers(db, String(row.id))).map((wager) => ({
            word: String(wager.word_form),
            side: String(wager.side),
            stake: Number(wager.stake),
            status: String(wager.status),
            payout: Number(wager.payout)
        })),
        purse,
        contractName: contractName(row.rope_count),
        muzzlePct: row.muzzle_pct,
        tier: tierFor(locale, row.rope_count, row.story_types),
        draft: {
            text: draftText,
            tokens: row.draft_tokens,
            spans: markText(draftText, ropeKeys, locale, policy)
        },
        rewrite: {
            status: row.rewrite_status,
            attempts: row.rewrite_attempts,
            violations: /** @type {string[]} */ (parseJson(row.rewrite_violations, [])),
            text: rewriteText,
            spans: rewriteText ? markText(rewriteText, ropeKeys, locale, policy) : []
        }
    };
}

/**
 * Lock a round. The story is re-analysed here — the browser's list is a
 * convenience, never a source of truth — and every rope must be one of its
 * words and none of the prompt's. The piece is graded for craft, the score
 * is pot × wager × craft, the round's side bets are settled against the
 * hidden piece, and the score is banked to the purse. If the member had no
 * open round, one is made — an old client is answered, not refused.
 * @param {Db} db
 * @param {Engine | null | undefined} ai
 * @param {{ userId: string, locale: unknown, day: string, story: unknown, ropes: unknown }} input
 * @returns {Promise<RoundView>}
 */
export async function lockDuel(db, ai, { userId, locale, day, story, ropes }) {
    if (!isLang(locale)) throw new DuelError(400, 'bad_language', String(locale));
    validateStory(story);
    if (!Array.isArray(ropes)) throw new DuelError(400, 'ropes_missing');

    const policy = defaultPolicy(locale);
    const storyAnalysis = analyze(story, locale, policy);
    const available = new Set(storyAnalysis.types.map((type) => type.key));
    const wanted = [...new Set(ropes)];
    const invalid = wanted.filter((key) => typeof key !== 'string' || !available.has(key));
    if (invalid.length) {
        throw new DuelError(400, 'rope_not_in_story', invalid.slice(0, 10).join(', '));
    }
    if (!wanted.length) throw new DuelError(400, 'ropes_missing');

    if ((await readLockedCount(db, userId, day)) >= DUEL.roundsPerDay) {
        throw new DuelError(429, 'round_limit', `${DUEL.roundsPerDay} rounds a day`);
    }

    let open = await readOpenRound(db, userId, day);
    if (!open) {
        if (!ai) throw new DuelError(503, 'no_engine');
        await prepareDuel(db, ai, userId, locale, day);
        open = await readOpenRound(db, userId, day);
        if (!open) throw new DuelError(503, 'draft_failed');
    }
    const draft = (await readRoundDraft(db, String(open.id))) ?? (open.draft_id ? await readDraftById(db, String(open.draft_id)) : null);
    if (!draft) throw new DuelError(503, 'draft_missing');

    // The prompt's words are hers already: the picker greys them out, and the
    // server refuses them however the ask was made. The same folding decides,
    // so the browser and this check can never disagree.
    const hers = new Set(analyze(draft.prompt_text, locale, policy).types.map((type) => type.key));
    const claimed = wanted.filter((key) => hers.has(key));
    if (claimed.length) {
        throw new DuelError(400, 'prompt_word', claimed.slice(0, 10).join(', '));
    }

    const verdict = judge(story, draft.content, locale, policy, wanted);
    // Two layers of judgement, both decided 2026-11-27: the pot is the piece
    // (one point per fifteen words), and the craft grade multiplies it. Hits
    // only — a miss costs nothing but its slot — rounded to points once.
    const pot = potFor(countWords(story));
    const craft = await gradeCraft(ai, /** @type {Lang} */ (locale), /** @type {string} */ (story));
    const score = wagerScore(verdict.hits, wanted.length, pot, craft);
    const saved = await db
        .prepare(
            `UPDATE oulipo_duel_rounds
                SET story = ?, policy = ?, ropes = ?, rope_count = ?, story_types = ?,
                    hits = ?, misses = ?, score = ?, muzzle_pct = ?, draft_tokens = ?,
                    craft = ?, status = 'locked', locked_at = datetime('now'),
                    updated_at = datetime('now')
              WHERE id = ? AND status = 'writing'`
        )
        .bind(
            story, JSON.stringify(policy), JSON.stringify(verdict.ropes), verdict.ropes.length, verdict.storyTypes,
            verdict.hits, verdict.misses, score, verdict.muzzlePct, verdict.draftTokens,
            craft, String(open.id)
        )
        .run();
    if (saved.meta?.changes !== 1) {
        // Someone else locked it first.
        throw new DuelError(409, 'already_locked');
    }

    // The ledger: one row per sent word — the day, the band it fell in, its
    // outcome, the contract it was sent under, and the pot it played for.
    for (const rope of verdict.ropes) {
        await db
            .prepare(
                `INSERT INTO duel_ledger
                   (id, round_id, user_id, locale, duel_date, word_key, word_form, band, hit, contract, pays)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
                crypto.randomUUID(), String(open.id), userId, locale, day,
                rope.key, rope.forms[0] ?? rope.key,
                hers.has(rope.key) ? 'prompt' : 'other',
                rope.hit ? 1 : 0, wanted.length, contractPays(wanted.length, pot)
            )
            .run();
    }

    // The round's side bets settle against the hidden piece, then the score
    // banks to the purse.
    const usedKeys = new Set(analyze(draft.content, locale, policy).types.map((type) => type.key));
    await settleWagers(db, { roundId: String(open.id), userId, usedKeys });
    const purse = await addPurse(db, userId, score);

    // The stored row is the truth: it carries the rewrite defaults too.
    return roundView(db, (await readRoundById(db, String(open.id))) ?? { ...open, ...verdict, score, craft }, draft, { purse });
}

// ── The rewrite ────────────────────────────────────────────────────────

/** How long a claim may stay held before another request may take it over. */
export const CLAIM_MINUTES = 5;
/** How long a request that lost the claim gives the holder before reporting. */
export const LOOK_MS = 1500;

/** @param {Row} row */
const isSettled = (row) => row.rewrite_status !== 'pending' && row.rewrite_status !== 'writing';

/** @param {number} ms */
export const defaultPause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Give a claim back so the next pass can be asked for. @param {Db} db @param {string} id */
function releaseClaim(db, id) {
    return db
        .prepare(
            `UPDATE oulipo_duel_rounds SET rewrite_status = 'pending' WHERE id = ? AND rewrite_status = 'writing'`
        )
        .bind(id)
        .run();
}

/** Where a rewrite stands. @typedef {'pending' | 'clean' | 'escaped'} RewriteStatus */

/**
 * One more pass of Sappho's rewrite, and what is to be kept of it. Shared by
 * the Duel and the Siege: each keeps its own claim on the pen and its own
 * row to save to, and neither makes a model call except through here.
 *
 * The best pass so far is kept. A pass after which nothing has ever come
 * back does not count. The next pass is told to avoid what got through this
 * one. What slips through is reported, never cleaned up and hidden.
 * @param {Engine} ai
 * @param {{
 *   locale: Lang,
 *   policy: Policy,
 *   draft: string,
 *   forbidden: string[],
 *   bannedKeys: string[],
 *   slipped: string[],
 *   soFar: { content: string, violations: string[], attempts: number }
 * }} state
 * @returns {Promise<{ content: string, violations: string[], slipped: string[] | null, attempts: number, status: RewriteStatus } | null>}
 *   null when nothing has come back in any pass: a silent engine never uses up a pass
 */
export async function nextRewritePass(ai, { locale, policy, draft, forbidden, bannedKeys, slipped, soFar }) {
    const attempt = await rewritePass(ai, locale, draft, forbidden, { policy, slipped, bannedKeys });
    const best = betterAttempt(soFar, attempt) ?? attempt;
    if (!best.content) return null;
    const attempts = soFar.attempts + 1;
    const clean = attempt.content !== '' && attempt.violations.length === 0;
    const last = attempts >= DUEL.rewriteAttempts;
    const status = clean || last ? (best.violations.length ? 'escaped' : 'clean') : 'pending';
    return {
        content: best.content,
        violations: best.violations,
        slipped: status === 'pending' ? (attempt.content ? attempt.violations : slipped) : null,
        attempts,
        status
    };
}

/**
 * Make one pass at the rewrite of a locked round, or return the finished
 * one. Found by round id when the caller knows it, else the member's latest
 * locked round of the day.
 *
 * A request makes at most one pass, so none stays open for longer than one
 * call to the model, and the page can tell the player how far she has got.
 * Exactly one request holds the pen: the first to claim the round makes the
 * pass, and any request arriving meanwhile reports where things stand.
 * Progress is stored after every pass, so a closed tab, a dropped connection
 * or a crashed request loses nothing. A claim left hanging by a crashed
 * request may be taken over after CLAIM_MINUTES.
 *
 * When the rewrite settles, the jailbreak dividend is paid: every hit word
 * she smuggled back into her piece pays the purse, once.
 * @param {Db} db
 * @param {Engine | null | undefined} ai
 * @param {{ userId: string, day: string, roundId?: string | null, pause?: (ms: number) => Promise<void> }} input
 * @returns {Promise<RoundView>}
 */
export async function rewriteDuel(db, ai, { userId, day, roundId = null, pause = defaultPause }) {
    const row = roundId
        ? await readRoundById(db, roundId)
        : await readLatestLocked(db, userId, day);
    if (!row) throw new DuelError(404, 'no_round');
    const draft = row.draft_id ? await readDraftById(db, String(row.draft_id)) : null;
    if (!draft) throw new DuelError(503, 'draft_missing');
    if (isSettled(row)) return roundView(db, row, draft);
    const again = async () => roundView(db, (await readRoundById(db, String(row.id))) ?? row, draft);

    const claim = await db
        .prepare(
            `UPDATE oulipo_duel_rounds
                SET rewrite_status = 'writing', updated_at = datetime('now')
              WHERE id = ?
                AND (rewrite_status = 'pending'
                     OR (rewrite_status = 'writing' AND updated_at < datetime('now', ?)))`
        )
        .bind(row.id, `-${CLAIM_MINUTES} minutes`)
        .run();
    if (claim.meta?.changes !== 1) {
        // Someone else holds the pen: give their pass a moment, then report.
        await pause(LOOK_MS);
        return again();
    }
    if (!ai) {
        await releaseClaim(db, String(row.id));
        throw new DuelError(503, 'no_engine');
    }

    const locale = /** @type {Lang} */ (row.locale);
    const policy = /** @type {Policy} */ (parseJson(row.policy, { verbs: 'strict' }));
    const ropes = /** @type {Rope[]} */ (parseJson(row.ropes, []));
    const forbidden = [...new Set(ropes.flatMap((rope) => [...(rope.forms || []), ...(rope.draftForms || [])]))];
    const next = await nextRewritePass(ai, {
        locale,
        policy,
        draft: draft.content,
        forbidden,
        bannedKeys: ropes.map((rope) => rope.key),
        slipped: /** @type {string[]} */ (parseJson(row.rewrite_slipped, [])),
        soFar: {
            content: row.rewrite || '',
            violations: /** @type {string[]} */ (parseJson(row.rewrite_violations, [])),
            attempts: Number(row.rewrite_attempts) || 0
        }
    });

    // Nothing has come back yet, in any pass: the round stays as it was,
    // the claim goes back, and the player can ask again. A silent engine
    // never uses up a pass.
    if (!next) {
        await releaseClaim(db, String(row.id));
        throw new DuelError(503, 'rewrite_failed');
    }

    await db
        .prepare(
            `UPDATE oulipo_duel_rounds
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
            String(row.id)
        )
        .run();

    // Settled: the jailbreak dividend, once per round. Every hit word she
    // smuggled back pays the purse.
    if (next.status === 'clean' || next.status === 'escaped') {
        const fresh = await readRoundById(db, String(row.id));
        if (fresh && (fresh.hostage_bonus === null || fresh.hostage_bonus === undefined)) {
            const hitKeys = new Set(ropes.filter((rope) => rope.hit).map((rope) => rope.key));
            const freed = new Set(next.violations.filter((key) => hitKeys.has(key)));
            const bonus = freed.size * SIDE_BET.jailbreakPays;
            await db
                .prepare('UPDATE oulipo_duel_rounds SET hostage_bonus = ? WHERE id = ? AND hostage_bonus IS NULL')
                .bind(bonus, String(row.id))
                .run();
            if (bonus > 0) await addPurse(db, userId, bonus);
        }
    }
    return again();
}

// ── The day's board ────────────────────────────────────────────────────

/**
 * The day's board for one language: each member's best round of the day, how
 * many rounds they played, ranked. A member who has asked not to appear on
 * scoreboards is left out entirely; everyone else is listed under the name
 * they chose, or their username.
 * @param {Db} db
 * @param {unknown} locale
 * @param {string} day
 * @param {{ userId?: string | null }} [options]
 * @returns {Promise<BoardRow[]>}
 */
export async function getBoard(db, locale, day, { userId } = {}) {
    if (!isLang(locale)) return [];
    let rows;
    try {
        ({ results: rows } = await db
            .prepare(
                `SELECT r.id, r.user_id, r.score, r.muzzle_pct, r.hits, r.misses, r.rope_count, r.rounds,
                        u.username, u.name
                   FROM (
                     SELECT *, rowid AS rid, ROW_NUMBER() OVER (
                                  PARTITION BY user_id
                                  ORDER BY score DESC, muzzle_pct DESC, created_at ASC, id ASC
                                ) AS rn,
                            COUNT(*) OVER (PARTITION BY user_id) AS rounds
                       FROM oulipo_duel_rounds
                      WHERE duel_date = ? AND locale = ? AND status = 'locked'
                   ) r
                   JOIN "user" u ON u.id = r.user_id
                  WHERE r.rn = 1 AND u.show_in_scoreboard = 1
                  ORDER BY r.score DESC, r.muzzle_pct DESC, r.created_at ASC, r.rid ASC
                  LIMIT ?`
            )
            .bind(day, locale, DUEL.boardSize)
            .all());
    } catch (error) {
        // Better an empty board than one that shows who asked not to be shown.
        console.error('[duel] board failed:', reason(error));
        return [];
    }
    return (rows || []).map(
        (row) =>
            /** @type {BoardRow} */ ({
                id: row.id,
                mine: Boolean(userId) && row.user_id === userId,
                name: row.name || row.username,
                score: row.score,
                muzzlePct: row.muzzle_pct,
                hits: row.hits,
                misses: row.misses,
                ropeCount: row.rope_count,
                rounds: Number(row.rounds ?? 1)
            })
    );
}

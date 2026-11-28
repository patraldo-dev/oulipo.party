// src/lib/server/purse.js
// What the member has banked, and the side bets staked from it. Every write
// to the purse or to a wager lives here, so the economy has one door. The
// purse is created lazily and seeded, so betting works on the first day.
import { SIDE_BET } from '#lib/oulipo/duel-rules.js';

/** @typedef {import('#lib/oulipo/types.js').Db} Db */

/**
 * The member's balance, created and seeded on first read.
 * @param {Db} db @param {string} userId
 * @returns {Promise<number>}
 */
export async function readPurse(db, userId) {
    const existing = await db.prepare('SELECT balance FROM duel_purse WHERE user_id = ?').bind(userId).first();
    if (existing) return Number(existing.balance);
    await db
        .prepare('INSERT INTO duel_purse (user_id, balance) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING')
        .bind(userId, SIDE_BET.startPurse)
        .run();
    const made = await db.prepare('SELECT balance FROM duel_purse WHERE user_id = ?').bind(userId).first();
    return Number(made?.balance ?? SIDE_BET.startPurse);
}

/**
 * Add to (or subtract from) the purse — scores banked, dividends, payouts.
 * @param {Db} db @param {string} userId @param {number} amount
 */
export async function addPurse(db, userId, amount) {
    await readPurse(db, userId);
    await db
        .prepare('UPDATE duel_purse SET balance = balance + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .bind(amount, userId)
        .run();
    const after = await db.prepare('SELECT balance FROM duel_purse WHERE user_id = ?').bind(userId).first();
    return Number(after?.balance ?? 0);
}

/**
 * The wagers open on a round, oldest first.
 * @param {Db} db @param {string} roundId
 */
export async function readOpenWagers(db, roundId) {
    const { results } = await db
        .prepare('SELECT * FROM duel_wagers WHERE round_id = ? AND status = \'open\' ORDER BY created_at, id')
        .bind(roundId)
        .all();
    return results ?? [];
}

/**
 * Every wager on a round, for the result card.
 * @param {Db} db @param {string} roundId
 */
export async function readRoundWagers(db, roundId) {
    const { results } = await db
        .prepare('SELECT word_form, side, stake, odds, status, payout FROM duel_wagers WHERE round_id = ? ORDER BY created_at, id')
        .bind(roundId)
        .all();
    return results ?? [];
}

/**
 * Place one stake: the purse is charged now, the round's hidden piece pays
 * or not at lock. The caller has validated word, stake and the open count.
 * @param {Db} db
 * @param {{ roundId: string, userId: string, locale: string, day: string, wordKey: string, wordForm: string, side: 'uses' | 'absent', stake: number, odds: number }} input
 */
export async function placeWager(db, { roundId, userId, locale, day, wordKey, wordForm, side, stake, odds }) {
    await readPurse(db, userId);
    await db
        .prepare(
            `INSERT INTO duel_wagers (id, round_id, user_id, locale, duel_date, word_key, word_form, side, stake, odds)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), roundId, userId, locale, day, wordKey, wordForm, side, stake, odds)
        .run();
    return addPurse(db, userId, -stake);
}

/**
 * Settle every open wager on a round: the piece decides. "She uses it" wins
 * when the piece used the word's family; "she never uses it" wins when it
 * did not. A winner's payout (stake × odds) goes to the purse; a loser's
 * stake was already charged. Returns the settled wagers for the result.
 * @param {Db} db
 * @param {{ roundId: string, userId: string, usedKeys: ReadonlySet<string> }} input
 */
export async function settleWagers(db, { roundId, userId, usedKeys }) {
    const open = await readOpenWagers(db, roundId);
    const settled = [];
    for (const wager of open) {
        const used = usedKeys.has(String(wager.word_key));
        const won = String(wager.side) === 'uses' ? used : !used;
        const payout = won ? Math.round(Number(wager.stake) * Number(wager.odds)) : 0;
        await db
            .prepare('UPDATE duel_wagers SET status = ?, payout = ?, settled_at = datetime(\'now\') WHERE id = ?')
            .bind(won ? 'won' : 'lost', payout, String(wager.id))
            .run();
        if (payout > 0) await addPurse(db, userId, payout);
        settled.push({ word: String(wager.word_form), side: String(wager.side), stake: Number(wager.stake), won, payout });
    }
    return settled;
}

/**
 * Refund the stakes of a round that will never lock (a member walked away
 * from it): the wagers are voided and the purse repaid.
 * @param {Db} db @param {string} roundId @param {string} userId
 */
export async function voidWagers(db, roundId, userId) {
    const open = await readOpenWagers(db, roundId);
    for (const wager of open) {
        await db
            .prepare('UPDATE duel_wagers SET status = \'void\', payout = 0, settled_at = datetime(\'now\') WHERE id = ?')
            .bind(String(wager.id))
            .run();
        await addPurse(db, userId, Number(wager.stake));
    }
}

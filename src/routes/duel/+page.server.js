// /duel — the solitaire duel, in rounds. Everything the page needs before
// the player locks comes from here: the round they are writing (if any), the
// round they last locked today (the result panel), the purse and the streak.
// A round's hidden piece only ever arrives through the lock endpoint.
import { duelDay, getBoard, readOpenRound, readLatestLocked, readPrompt, readStreak, roundView } from '#lib/server/oulipo-duel.js';
import { readPurse } from '#lib/server/purse.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ locals }) {
    const base = { locale: locals.locale, signedIn: Boolean(locals.user) };
    const empty = {
        ...base,
        unavailable: false,
        round: null,
        openRoundId: null,
        prompt: null,
        draftReady: false,
        purse: null,
        streak: 0,
        board: /** @type {import('#lib/oulipo/types.js').BoardRow[]} */ ([])
    };
    if (!locals.user) return empty;

    const db = locals.db;
    const day = duelDay();
    try {
        const open = await readOpenRound(db, locals.user.id, day);
        const locked = await readLatestLocked(db, locals.user.id, day);
        let round = /** @type {import('#lib/oulipo/types.js').RoundView | null} */ (null);
        if (locked) {
            const draft = locked.draft_id ? await db.prepare('SELECT * FROM oulipo_duel_drafts WHERE id = ?').bind(String(locked.draft_id)).first() : null;
            if (draft) round = await roundView(db, locked, draft);
        }
        const purse = await readPurse(db, locals.user.id);
        const streak = await readStreak(db, locals.user.id, day);
        // A round being written is shown with its own prompt; a fresh visit
        // with nothing open shows today's prompt so the page can prepare.
        const promptRow = open
            ? await db.prepare('SELECT id, prompt_text FROM oulipo_duel_drafts WHERE round_id = ?').bind(String(open.id)).first()
            : await readPrompt(db, day, base.locale);
        return {
            ...base,
            unavailable: false,
            round,
            openRoundId: open ? String(open.id) : null,
            prompt: promptRow ? { id: String(promptRow.id), text: String(promptRow.prompt_text) } : null,
            draftReady: Boolean(open),
            purse,
            streak,
            board: await getBoard(db, base.locale, day, { userId: locals.user.id })
        };
    } catch (error) {
        // Until the tables exist the page simply says the duel is not open.
        console.error('[duel] load failed:', error instanceof Error ? error.message : error);
        return { ...empty, unavailable: true };
    }
}

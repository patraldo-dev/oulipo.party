// / — the solitaire duel. Everything the page needs before the player locks
// comes from here; the draft itself only ever arrives through the lock
// endpoint, inside a locked round.
import { duelDay, getBoard, readDraft, readPrompt, readRound, roundView } from '#lib/server/oulipo-duel.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ locals }) {
    const base = { locale: locals.locale, signedIn: Boolean(locals.user) };
    const empty = {
        ...base,
        unavailable: false,
        round: null,
        prompt: null,
        draftReady: false,
        board: /** @type {import('#lib/oulipo/types.js').BoardRow[]} */ ([])
    };
    if (!locals.user) return empty;

    const db = locals.db;
    const day = duelDay();
    try {
        const row = await readRound(db, locals.user.id, day);
        let round = /** @type {import('#lib/oulipo/types.js').RoundView | null} */ (null);
        if (row) {
            const draft = await readDraft(db, row.locale, row.duel_date);
            if (draft) round = roundView(row, draft);
        }
        const today = round ? null : await readPrompt(db, day, base.locale);
        return {
            ...base,
            unavailable: false,
            round,
            prompt: today ? { id: String(today.id), text: String(today.prompt_text) } : null,
            draftReady: Boolean(round) || Boolean(await readDraft(db, base.locale, day)),
            board: await getBoard(db, base.locale, day, { userId: locals.user.id })
        };
    } catch (error) {
        // Until the tables exist the page simply says the duel is not open.
        console.error('[duel] load failed:', error instanceof Error ? error.message : error);
        return { ...empty, unavailable: true };
    }
}

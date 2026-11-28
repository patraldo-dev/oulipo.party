// / — the day's games. The landing page offers the Duel and the Siege, and
// says what the member has already done of each today.
import { duelDay, readLatestLocked, readStreak } from '#lib/server/oulipo-duel.js';
import { siegeStatus } from '#lib/server/siege.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ locals }) {
    const base = { locale: locals.locale, signedIn: Boolean(locals.user) };
    const nothing = {
        ...base,
        duel: /** @type {{ score: number } | null} */ (null),
        streak: 0,
        siege: /** @type {{ open: number, waiting: number } | null} */ (null)
    };
    if (!locals.user) return nothing;
    try {
        const day = duelDay();
        const round = await readLatestLocked(locals.db, locals.user.id, day);
        const streak = await readStreak(locals.db, locals.user.id, day);
        const siege = await siegeStatus(locals.db, locals.user.id, day);
        return {
            ...base,
            duel: round ? { score: Number(round.score) } : null,
            streak,
            siege
        };
    } catch (error) {
        // Each game's own page says more when something is wrong; the landing
        // page goes on offering them.
        console.error('[home] load failed:', error instanceof Error ? error.message : error);
        return nothing;
    }
}

// src/lib/oulipo/duel-rules.js
// The limits of one duel. The page shows them and the API enforces them
// from this one place, so the two can never disagree.

export const DUEL = Object.freeze({
    /** The least a piece may be: there have to be words to send. */
    minStoryWords: 30,
    /**
     * A longer piece is not refused. Its first so many words are what go into
     * the duel; the page says so, and picks the words to send from them.
     */
    maxStoryWords: 300,
    /** Hard caps on request size, before anything reaches the model. */
    maxStoryChars: 10000,
    minRopes: 1,
    /** Passes Sappho gets at the rewrite; one pass per request. */
    rewriteAttempts: 4,
    /**
     * Output caps for the model. Her duel pieces run 120–180 words; the
     * caps leave room for a long piece and stop a runaway one, since every
     * token generated is seconds the player waits.
     */
    maxDraftTokens: 480,
    maxRewriteTokens: 640,
    /** The most text ever stored or shown for one of her pieces. */
    maxPieceChars: 8000,
    /** Names listed on the day's board. */
    boardSize: 10
});

/** Scoring in the Siege: a word the draft used earns +1, a word it did not costs 1. */
export const HIT = 1;
export const MISS = -1;

/**
 * The Duel's wager (decided 2026-11-27, uncapped after the first day of
 * play). Hits only — a miss costs nothing but its slot. There is no limit on
 * how many words may be sent; the wager is the count, in inverse proportion:
 * a hit pays 20 divided by the words sent, so a whole piece can go but each
 * of its words is worth almost nothing. Four words or fewer pay ×5 — the
 * moon shot — and no bet pays more than that. A perfect round therefore
 * scores 20 whatever the count: 4 hits at ×5, or 95 hits at ×0.21.
 * The names below label the regions of the dial, in `duel.contract.0…5`.
 */
export const CONTRACT = Object.freeze({
    /** The most a single hit can pay. */
    topPays: 5,
    /** The dividend the wager divides: pays = dividend / count. */
    dividend: 20,
    /** Where each wager's name begins. */
    tiers: Object.freeze([
        /** Up to 4 words: the moon shot. */
        { upTo: 4, name: 0 },
        /** Up to 8: the bold wager. */
        { upTo: 8, name: 1 },
        /** Up to 14: the steady hand. */
        { upTo: 14, name: 2 },
        /** Up to 20: the full cord. */
        { upTo: 20, name: 3 },
        /** Up to 40: the wide net. */
        { upTo: 40, name: 4 },
        /** Beyond that: the buckshot. */
        { upTo: Number.POSITIVE_INFINITY, name: 5 }
    ])
});

/**
 * What one hit pays for a wager of `count` words: twenty divided by the
 * count, capped at the moon shot's ×5. Rounded nowhere — the score is
 * rounded once, at the end.
 * @param {number} count
 */
export function contractPays(count) {
    if (!Number.isFinite(count) || count <= 0) return CONTRACT.topPays;
    return Math.min(CONTRACT.topPays, CONTRACT.dividend / count);
}

/**
 * Which named wager a count of words sits in — the index into the messages
 * `duel.contract.0…5`.
 * @param {number} count
 */
export function contractName(count) {
    for (const tier of CONTRACT.tiers) if (count <= tier.upTo) return tier.name;
    return CONTRACT.tiers[CONTRACT.tiers.length - 1].name;
}

/**
 * The score a round earns: hits only, each paying its wager's rate, rounded
 * to whole points once. Never below zero — a miss costs nothing but its slot.
 * @param {number} hits
 * @param {number} count
 */
export function wagerScore(hits, count) {
    return Math.round(hits * contractPays(count));
}

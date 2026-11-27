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
    boardSize: 10,
    /**
     * The most words one duel may send. The wager is the count: the slider
     * cannot offer more, and the API refuses more.
     */
    sendCap: 20
});

/** Scoring in the Siege: a word the draft used earns +1, a word it did not costs 1. */
export const HIT = 1;
export const MISS = -1;

/**
 * The Duel's wager, decided 2026-11-27. Hits only — a miss costs nothing but
 * its slot — and how much a hit pays is set by how many words were sent:
 * fewer words, a bolder bet, a bigger pay. The numbers here are the opening
 * guess; the ledger (migration 0006) is what will retune them on real play.
 */
export const CONTRACT = Object.freeze({
    tiers: Object.freeze([
        /** Up to 4 words: the moon shot. */
        { upTo: 4, pays: 5 },
        /** Up to 8: the bold wager. */
        { upTo: 8, pays: 2.5 },
        /** Up to 14: the steady hand. */
        { upTo: 14, pays: 1.5 },
        /** Up to the cap of 20: the full cord. */
        { upTo: DUEL.sendCap, pays: 1 }
    ])
});

/**
 * What a hit pays for a contract of `count` words. Anything above the cap
 * pays the last tier's rate; the cap itself is refused before this is asked.
 * @param {number} count
 */
export function contractPays(count) {
    for (const tier of CONTRACT.tiers) if (count <= tier.upTo) return tier.pays;
    return CONTRACT.tiers[CONTRACT.tiers.length - 1].pays;
}

/**
 * Which named wager a contract of `count` words is — the index into the
 * messages `duel.contract.0…3`.
 * @param {number} count
 */
export function contractName(count) {
    for (const [index, tier] of CONTRACT.tiers.entries()) if (count <= tier.upTo) return index;
    return CONTRACT.tiers.length - 1;
}

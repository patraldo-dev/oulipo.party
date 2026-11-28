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
     * Locked rounds a member may play in one day. Not a game rule — a
     * safeguard on model cost; raise it whenever.
     */
    roundsPerDay: 12
});

/** Scoring in the Siege: a word the draft used earns +1, a word it did not costs 1. */
export const HIT = 1;
export const MISS = -1;

/**
 * The Duel's wager. Hits only — a miss costs nothing but its slot. No limit
 * on how many words may be sent, and the pay falls in inverse proportion: a
 * hit pays the pot divided by the words sent. The pot is the piece itself —
 * one point per fifteen words written — so four lazy words from a thin piece
 * score almost nothing, and the only way to play for a lot is to have
 * written a lot. The craft grade multiplies the whole thing. The names
 * below label the regions of the send dial, in `duel.contract.0…5`.
 */
export const CONTRACT = Object.freeze({
    /** Words written per point of pot. */
    wordsPerPoint: 15,
    /** The smallest pot a playable piece (30 words) can have. */
    minPot: 2,
    /** Where each wager's name begins. */
    tiers: Object.freeze([
        /** Up to 4 words sent: the moon shot. */
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
 * The pot a piece of `pieceWords` words plays for: one point per fifteen
 * words, never less than the thinnest playable piece's two.
 * @param {number} pieceWords
 */
export function potFor(pieceWords) {
    if (!Number.isFinite(pieceWords) || pieceWords <= 0) return CONTRACT.minPot;
    return Math.max(CONTRACT.minPot, Math.round(pieceWords / CONTRACT.wordsPerPoint));
}

/**
 * What one hit pays for a wager of `count` words out of a `pot`: the pot
 * divided by the count. Rounded nowhere — the score is rounded once, at the
 * end. (The sent count alone still names the wager, `contractName`.)
 * @param {number} count @param {number} pot
 */
export function contractPays(count, pot) {
    if (!Number.isFinite(count) || count <= 0) return pot;
    return pot / count;
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
 * The craft grade's multiplier, as the result names it: ✦ plain, ✦✦ able,
 * ✦✦✦ vivid, ✦✦✦✦ remarkable. Anything unknown grades as able (×1) — a
 * failed or refused grade must never punish a writer.
 * @param {number | null | undefined} craft
 */
export function craftPays(craft) {
    return [0.75, 1, 1.25, 1.5][typeof craft === 'number' ? craft : 1] ?? 1;
}

/**
 * The score a round earns: hits only, each paying pot ÷ sent, times the
 * craft grade, rounded to whole points once. Never below zero — a miss
 * costs nothing but its slot.
 * @param {number} hits @param {number} count @param {number} pot @param {number | null | undefined} craft
 */
export function wagerScore(hits, count, pot, craft) {
    return Math.round(hits * contractPays(count, pot) * craftPays(craft));
}

/**
 * Side bets, played with the purse. A member stakes purse points, before
 * locking, on their own round's hidden piece: that she uses a word (rare —
 * pays big) or that she never does. Settled by the piece itself; every
 * wager is recorded in `duel_wagers` so the odds can be retuned on play.
 */
export const SIDE_BET = Object.freeze({
    /** "She uses it" — a long shot, as measured: about one word in twenty. */
    usesPays: 12,
    /** "She never uses it" — the likely case, pays a little. */
    absentPays: 1.5,
    /** Stakes a member may have open on one round. */
    maxOpen: 3,
    /** The least a stake may be. */
    minStake: 1,
    /** What a new member's purse holds, so betting works on day one. */
    startPurse: 10,
    /** Each hit word she smuggles back into her rewrite pays its dividend. */
    jailbreakPays: 2
});

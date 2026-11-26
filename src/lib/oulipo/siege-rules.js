// src/lib/oulipo/siege-rules.js
// The rules of the Siege: how many may play, how a room is named, and how a
// resolved siege is scored. Pure, like the engine. The server's flow
// (src/lib/server/siege.js) and the tests both draw on it.
import { HIT, MISS } from './duel-rules.js';
import { analyze, defaultPolicy, judge } from './engine.js';

/** @typedef {import('./types.js').Lang} Lang */
/** @typedef {import('./types.js').WordTag} WordTag */
/** @typedef {import('./types.js').SiegePlayer} SiegePlayer */
/** @typedef {import('./types.js').SiegeScore} SiegeScore */
/** @typedef {import('./types.js').SiegeRow} SiegeRow */

export const SIEGE = Object.freeze({
    /** Fewer than this locked, and there is no siege. */
    minPlayers: 2,
    maxPlayers: 8,
    /** A room's code: short enough to read out, with no 0/O or 1/I/L in it. */
    codeLength: 5,
    codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    /** Added to a hit that only one player sent. */
    originalBonus: 1,
    /** Added to a hit that every player sent, once for each player. */
    unanimousEach: 1,
    /** How often a room is asked about while it waits for the others. */
    pollMs: 3000,
    /** Rooms a member may be in, and may start in a day. */
    roomsPerMember: 20,
    startsPerDay: 5,
    /** Wrong codes a member may try in a day. */
    joinMissesPerDay: 30
});

const CODE = new RegExp(`^[${SIEGE.codeAlphabet}]{${SIEGE.codeLength}}$`);

/** A code as a player may type it: any case, with spaces or dashes. @param {unknown} value */
export const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[\s-]/g, '');

/** @param {string} code */
export const isCode = (code) => CODE.test(code);

/**
 * A new room's code. A byte is only used when no symbol of the alphabet is
 * favoured by it, so that no code is likelier than another.
 * @returns {string}
 */
export function newCode() {
    const size = SIEGE.codeAlphabet.length;
    const usable = 256 - (256 % size);
    let code = '';
    while (code.length < SIEGE.codeLength) {
        for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
            if (byte < usable && code.length < SIEGE.codeLength) code += SIEGE.codeAlphabet[byte % size];
        }
    }
    return code;
}

/**
 * Score a resolved siege. Each player's words are judged against the same
 * hidden piece, as in the Duel: a hit is +1 and a miss −1. Then, for hits
 * only, a hit that only one player sent earns the original bonus, and a hit
 * that every player sent earns the unanimous bonus once per player. A miss
 * never earns anything, so sending everything stays as risky as in the Duel.
 * A word among the prompt's own words earns neither bonus: every player
 * echoes the prompt, and a unanimous hit would come for free.
 * @param {{ draft: string, locale: Lang, prompt: string, entries: { userId: string, story: string, ropes: string[] }[] }} input
 * @returns {SiegeScore}
 */
export function scoreSiege({ draft, locale, prompt, entries }) {
    const policy = defaultPolicy(locale);
    const verdicts = entries.map((entry) => judge(entry.story, draft, locale, policy, entry.ropes));
    const players = entries.length;
    // Bonuses are for what happened between players. Alone there is nobody to
    // be original against, and the server never resolves a room with fewer
    // than two locked.
    const contested = players >= SIEGE.minPlayers;

    // Who sent each word.
    /** @type {Map<string, number>} */
    const senders = new Map();
    for (const verdict of verdicts) {
        for (const rope of verdict.ropes) senders.set(rope.key, (senders.get(rope.key) ?? 0) + 1);
    }
    const promptKeys = new Set(analyze(prompt, locale, policy).types.map((type) => type.key));

    /** @type {SiegePlayer[]} */
    const scored = entries.map((entry, i) => {
        const verdict = verdicts[i];
        let original = 0;
        let unanimous = 0;
        const ropes = verdict.ropes.map((rope) => {
            /** @type {WordTag} */
            let tag = 'plain';
            if (rope.hit && contested) {
                if (promptKeys.has(rope.key)) tag = 'prompt';
                else if (senders.get(rope.key) === 1) {
                    tag = 'original';
                    original++;
                } else if (senders.get(rope.key) === players) {
                    tag = 'unanimous';
                    unanimous++;
                }
            }
            return { ...rope, tag };
        });
        const bonus = original * SIEGE.originalBonus + unanimous * players * SIEGE.unanimousEach;
        return {
            userId: entry.userId,
            ropes,
            hits: verdict.hits,
            misses: verdict.misses,
            original,
            unanimous,
            bonus,
            score: verdict.hits * HIT + verdict.misses * MISS + bonus,
            storyTypes: verdict.storyTypes
        };
    });

    // Every word anyone sent, in every form it took on either side: what her
    // rewrite has to avoid. And the room's muzzle: anyone's hit puts a word
    // of hers off-limits.
    /** @type {Map<string, Set<string>>} */
    const union = new Map();
    const hitKeys = new Set();
    let muzzled = 0;
    let draftTokens = 0;
    for (const verdict of verdicts) {
        draftTokens = verdict.draftTokens;
        for (const rope of verdict.ropes) {
            const forms = union.get(rope.key) ?? new Set();
            for (const form of [...rope.forms, ...rope.draftForms]) forms.add(form);
            union.set(rope.key, forms);
            if (rope.hit && !hitKeys.has(rope.key)) {
                hitKeys.add(rope.key);
                muzzled += rope.draftCount;
            }
        }
    }

    return {
        players: scored,
        union: {
            keys: [...union.keys()],
            forms: [...new Set([...union.values()].flatMap((forms) => [...forms]))]
        },
        muzzlePct: draftTokens ? Math.round((100 * muzzled) / draftTokens) : 0
    };
}

/**
 * The room's table: by score, then by hits, then by original hits. Players
 * with the same score share a place.
 * @param {SiegeScore} score
 * @param {{ userId: string, name: string }[]} names
 * @param {string | null} [me]
 * @returns {SiegeRow[]}
 */
export function siegeTable(score, names, me = null) {
    const byPlayer = new Map(names.map((name) => [name.userId, name.name]));
    const sorted = [...score.players].sort(
        (a, b) =>
            b.score - a.score ||
            b.hits - a.hits ||
            b.original - a.original ||
            (byPlayer.get(a.userId) ?? '').localeCompare(byPlayer.get(b.userId) ?? '')
    );
    /** @type {SiegeRow[]} */
    const rows = [];
    sorted.forEach((player, i) => {
        const above = rows[i - 1];
        rows.push({
            userId: player.userId,
            name: byPlayer.get(player.userId) ?? '·',
            mine: player.userId === me,
            // A tie shares the place of the player it ties with.
            rank: above && above.score === player.score ? above.rank : i + 1,
            hits: player.hits,
            misses: player.misses,
            original: player.original,
            unanimous: player.unanimous,
            bonus: player.bonus,
            score: player.score
        });
    });
    return rows;
}

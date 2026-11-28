// POST /api/duel/wager — stake purse points on the open round's hidden
// piece: "she uses it" or "she never uses it". Charged now, settled when the
// round locks. Answers with the purse and the round's open stakes.
import { json } from '@sveltejs/kit';
import { analyze, defaultPolicy, isLang } from '#lib/oulipo/engine.js';
import { SIDE_BET } from '#lib/oulipo/duel-rules.js';
import { DuelError, duelDay, readOpenRound } from '#lib/server/oulipo-duel.js';
import { placeWager, readOpenWagers, readPurse } from '#lib/server/purse.js';
import { fail, readJson } from '../../_respond.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
    if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
    const body = (await readJson(request)) ?? null;
    if (!body || typeof body !== 'object') return json({ error: 'bet_missing' }, { status: 400 });
    const { word, side, stake } = /** @type {Record<string, unknown>} */ (body);
    if (typeof word !== 'string' || !word.trim()) return json({ error: 'word_missing' }, { status: 400 });
    if (side !== 'uses' && side !== 'absent') return json({ error: 'side_unknown' }, { status: 400 });
    const amount = Math.floor(Number(stake));
    if (!Number.isFinite(amount) || amount < SIDE_BET.minStake) return json({ error: 'stake_small' }, { status: 400 });

    const db = locals.db;
    const userId = locals.user.id;
    const locale = locals.locale;
    try {
        if (!isLang(locale)) throw new DuelError(400, 'bad_language', String(locale));
        const open = await readOpenRound(db, userId, duelDay());
        if (!open) throw new DuelError(409, 'round_missing');
        // The staked word must be one the member could send: a word of their
        // piece, and none of the prompt's — those she got for free. An open
        // round holds no story until it is written, so analyse what the
        // browser sent against the round's own kept words: the same check the
        // picker makes, made here.
        const policy = defaultPolicy(locale);
        const storyText = String(open.story ?? '');
        const source = storyText.trim() ? storyText : String(body.story ?? '');
        const key = analyze(source, locale, policy).types.find((type) => type.key === word || type.display === word)?.key;
        if (!key) throw new DuelError(400, 'word_unknown', String(word));
        const draft = await db.prepare('SELECT prompt_text FROM oulipo_duel_drafts WHERE round_id = ?').bind(String(open.id)).first();
        const hers = new Set(analyze(String(draft?.prompt_text ?? ''), locale, policy).types.map((type) => type.key));
        if (hers.has(key)) throw new DuelError(400, 'prompt_word', String(word));

        const openWagers = await readOpenWagers(db, String(open.id));
        if (openWagers.length >= SIDE_BET.maxOpen) throw new DuelError(429, 'bet_limit');
        const before = await readPurse(db, userId);
        if (amount > before) throw new DuelError(400, 'purse_short', `${before}`);
        const purse = await placeWager(db, {
            roundId: String(open.id),
            userId,
            locale,
            day: duelDay(),
            wordKey: key,
            wordForm: String(word),
            side,
            stake: amount,
            odds: side === 'uses' ? SIDE_BET.usesPays : SIDE_BET.absentPays
        });
        return json({ purse, wagers: await readOpenWagers(db, String(open.id)) });
    } catch (error) {
        return fail(error, 'duel wager');
    }
}

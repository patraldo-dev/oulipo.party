// src/lib/server/sappho-craft.js
// The craft grade: one small model call at lock, reading the whole piece and
// answering a single digit. It multiplies the round's score (✦ ×0.75, ✦✦ ×1,
// ✦✦✦ ×1.25, ✦✦✦✦ ×1.5) — part of the challenge is how well the piece is
// written. It never blocks a lock: any failure or nonsense answers ✦✦ (×1),
// the grade of a piece the model could not read.
import { SAPPHO_MODEL } from './sappho-persona.js';

const GRADE_TOKENS = 8;

const GUIDES = {
    en: 'You are a merciless but fair editor. Rate this piece of writing for craft — concision, vividness, sophistication — as a single digit: 0 plain, 1 able, 2 vivid, 3 remarkable. Judge the whole piece, not any word in it. Answer with the digit and nothing else.',
    es: 'Eres un editor despiadado pero justo. Califica esta pieza por su factura —concisión, viveza, sofisticación— con un solo dígito: 0 plana, 1 competente, 2 vívida, 3 notable. Juzga la pieza entera, no ninguna palabra suelta. Responde solo con el dígito.',
    fr: 'Tu es un rédacteur impitoyable mais juste. Note cette pièce pour sa facture — concision, vivacité, sophistication — d’un seul chiffre : 0 plate, 1 habile, 2 vive, 3 remarquable. Juge la pièce entière, pas un mot isolé. Réponds seulement par le chiffre.'
};

/**
 * Grade a piece for craft: 0–3, or 1 (able) whenever the model cannot be
 * trusted to have answered. Never throws.
 * @param {import('./oulipo-sappho.js').Engine | null | undefined} ai
 * @param {import('#lib/oulipo/types.js').Lang} locale
 * @param {string} piece
 * @returns {Promise<number>}
 */
export async function gradeCraft(ai, locale, piece) {
    if (!ai) return 1;
    try {
        const response = await ai.run(SAPPHO_MODEL, {
            messages: [
                { role: 'system', content: GUIDES[locale] ?? GUIDES.en },
                { role: 'user', content: piece.slice(0, 4000) }
            ],
            max_tokens: GRADE_TOKENS,
            temperature: 0.2
        });
        const text = String(/** @type {{ response?: unknown }} */ (response)?.response ?? '').trim();
        const digit = text.match(/[0-3]/)?.[0];
        return digit === undefined ? 1 : Number(digit);
    } catch {
        return 1;
    }
}

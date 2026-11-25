// src/lib/server/daily-prompt.js
// The day's prompt, one per language.
//
// On patrouch.ca the duel rode on the prompt its community of writers saw
// that day. Here the site makes its own: the first player to ask for a day
// in a language has the model write it, and it is kept for everyone after.
// A prompt the model fails to write is never stored, so the next request
// tries again instead of inheriting a placeholder.
/** @typedef {import('#lib/oulipo/types.js').Lang} Lang */
/** @typedef {import('#lib/oulipo/types.js').Db} Db */
/** @typedef {import('#lib/oulipo/types.js').Engine} Engine */

import { isLang } from '#lib/oulipo/engine.js';
import { responseText } from './oulipo-sappho.js';

export const PROMPT_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';

/** @template T @param {readonly T[]} list @returns {T} */
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Outside these lengths the model has strayed: a fragment, or a whole essay. */
export const PROMPT_CHARS = Object.freeze({ min: 30, max: 400 });

const LANGUAGE = { en: 'English', es: 'Spanish', fr: 'French' };
const THEMES = [
    'memory and forgetting',
    'a secret kept too long',
    'an unexpected inheritance',
    'a conversation overheard',
    'something found in an old coat pocket',
    'the last day of a job',
    'a letter that arrives late',
    'a door left open on purpose',
    'a promise made at night',
    'a stranger who knows your name',
    'the smell of a house you left behind',
    'an object that passes through three hands',
    'a map with one street missing',
    'a phone that rings once a year'
];
const TONES = ['tender', 'unsettling', 'wistful', 'quietly funny', 'hopeful', 'melancholy', 'strange'];
const FORMS = ['a scene', 'a letter', 'a monologue', 'a dialogue', 'the start of a story', 'a memory'];

/** Thrown when today's prompt cannot be had. The API turns it into a 503. */
export class PromptError extends Error {
    /**
     * @param {string} code
     * @param {string | null} [detail]
     */
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'PromptError';
        this.code = code;
        this.detail = detail || null;
    }
}

/** @param {unknown} error */
const reason = (error) => (error instanceof Error ? error.message : String(error));

/** @param {Db} db @param {string} day @param {string} locale @returns {Promise<import('#lib/oulipo/types.js').Row | null>} */
export function readPrompt(db, day, locale) {
    return db
        .prepare('SELECT id, prompt_text FROM daily_prompts WHERE prompt_date = ? AND locale = ?')
        .bind(day, locale)
        .first();
}

/** The prompt without anything the model wrapped around it. @param {string} text */
function clean(text) {
    return text
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .trim()
        .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** @param {string} text @param {Lang} locale */
const isPlausible = (text, locale) =>
    text.length >= PROMPT_CHARS.min &&
    text.length <= PROMPT_CHARS.max &&
    // A prompt in one of the three languages has no use for other scripts.
    !/[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF]/u.test(text) &&
    isLang(locale);

/**
 * Ask the model for a prompt. Throws PromptError rather than return anything
 * that is not a usable prompt.
 * @param {Engine} ai
 * @param {Lang} locale
 * @returns {Promise<string>}
 */
export async function writePrompt(ai, locale) {
    const language = LANGUAGE[locale];
    let text;
    try {
        const response = await ai.run(PROMPT_MODEL, {
            messages: [
                {
                    role: 'system',
                    content:
                        `You write the one writing prompt of the day for a community of adult writers. ` +
                        `It is a single concrete situation, two sentences at most, in the second person, ` +
                        `that makes a writer want to start right away. ` +
                        `Write it in ${language} only. Output the prompt and nothing else: ` +
                        `no title, no quotation marks, no translation, no commentary.`
                },
                {
                    role: 'user',
                    content: `Theme: ${pick(THEMES)}. Tone: ${pick(TONES)}. Form: ${pick(FORMS)}.`
                }
            ],
            max_tokens: 200,
            temperature: 0.8
        });
        text = clean(responseText(response));
    } catch (error) {
        throw new PromptError('engine_failed', reason(error));
    }
    if (!isPlausible(text, locale)) {
        throw new PromptError('bad_prompt', text.slice(0, 80) || 'empty');
    }
    return text;
}

/**
 * The day's prompt for a language, written if nobody has asked for it yet.
 * @param {Db} db
 * @param {Engine | null | undefined} ai
 * @param {Lang} locale
 * @param {string} day
 * @returns {Promise<{ id: string, prompt_text: string }>}
 */
export async function ensurePrompt(db, ai, locale, day) {
    const existing = await readPrompt(db, day, locale);
    if (existing) {
        return { id: String(existing.id), prompt_text: String(existing.prompt_text) };
    }
    if (!ai) throw new PromptError('no_engine', 'no model to write the prompt');
    const promptText = await writePrompt(ai, locale);
    const id = crypto.randomUUID();
    try {
        await db
            .prepare('INSERT INTO daily_prompts (id, locale, prompt_date, prompt_text, model) VALUES (?, ?, ?, ?, ?)')
            .bind(id, locale, day, promptText, PROMPT_MODEL)
            .run();
    } catch (error) {
        // Two players asked at once: the prompt that won the race is the day's.
        const winner = await readPrompt(db, day, locale);
        if (winner) return { id: String(winner.id), prompt_text: String(winner.prompt_text) };
        throw error;
    }
    return { id, prompt_text: promptText };
}

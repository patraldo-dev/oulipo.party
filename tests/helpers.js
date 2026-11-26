// Test doubles for the duel's server flow: a D1-shaped wrapper around an
// in-memory SQLite database, and a Workers AI binding that answers from a
// script. Nothing here touches a Cloudflare account or a live database.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = (path) => readFileSync(join(root, path), 'utf8');

// Only what the duel reads from the rest of the schema: members. The sign-in
// tables in full are created from the schema file by tests/auth.test.js.
const SCHEMA = `
CREATE TABLE "user" (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  show_in_scoreboard INTEGER NOT NULL DEFAULT 1
);
`;

export class SqliteD1 {
    constructor() {
        this.db = new DatabaseSync(':memory:');
        this.db.exec(SCHEMA);
        // The real migrations, exactly as they are applied.
        this.db.exec(sql('migrations/0002_duel.sql'));
        this.db.exec(sql('migrations/0003_daily_prompts.sql'));
        this.db.exec(sql('migrations/0005_siege.sql'));
    }

    prepare(query) {
        const statement = this.db.prepare(query);
        return {
            bind: (...args) => ({
                first: async () => statement.get(...args) ?? null,
                all: async () => ({ success: true, results: statement.all(...args) }),
                run: async () => {
                    const result = statement.run(...args);
                    return {
                        success: true,
                        meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) }
                    };
                }
            })
        };
    }

    rows(query, ...args) {
        return this.db.prepare(query).all(...args);
    }
}

/**
 * A Workers AI binding whose answers come from `script`, one per call.
 * An Error in the script is thrown instead of answered.
 */
export function fakeAi(script = []) {
    const queue = [...script];
    const calls = [];
    return {
        calls,
        get pending() {
            return queue.length;
        },
        run: async (model, input) => {
            calls.push({ model, input });
            const next = queue.shift();
            if (next instanceof Error) throw next;
            return { response: next };
        }
    };
}

/** A member. `name` is what the board shows; without it the username stands in. */
export const addUser = (db, id, { username = id, name = null, onBoard = 1 } = {}) =>
    db.prepare('INSERT INTO "user" (id, username, name, show_in_scoreboard) VALUES (?, ?, ?, ?)')
        .bind(id, username, name ?? username, onBoard)
        .run();

export const addPrompt = (db, day, locale, text) =>
    db
        .prepare(
            `INSERT INTO daily_prompts (id, locale, prompt_date, prompt_text, model)
             VALUES (?, ?, ?, ?, 'test')`
        )
        .bind(`prompt-${locale}-${day}`, locale, day, text)
        .run();

/** A hidden draft written straight to the table, so a test need not generate one. */
export const addDraft = (db, day, locale, content, prompt = 'The prompt of the day') =>
    db
        .prepare(
            `INSERT INTO oulipo_duel_drafts (id, locale, duel_date, prompt_id, prompt_text, content, model)
             VALUES (?, ?, ?, NULL, ?, ?, 'test')`
        )
        .bind(`draft-${locale}-${day}`, locale, day, prompt, content)
        .run();

/** The same scene in the three languages, with the draft each is scored against. */
export const SCENES = {
    en: {
        story: `The lighthouse keeper counted the gulls again and arrived at the same number as yesterday. Below the cliff, the sea folded itself into the rocks with a patience that frightened her. She wrote the count in the ledger, beside her father's handwriting, and wondered whether he had also listened for the bell that no longer rang. When the fog came in, she lit the lamp and watched the beam sweep across water that gave nothing back.`,
        draft: `The lighthouse keeper watched the sea. The fog came in, and the lamp burned for no one. She listened to the water and heard her father's voice.`,
        /** Rope keys exactly as the engine gives them. */
        ropes: ['lighthouse', 'gull', 'lamp', 'father'],
        rewrite: `The keeper watched the water. Night came, and the little light burned for no one. She listened and heard a voice she knew.`
    },
    es: {
        story: `La guardiana del faro contó las gaviotas otra vez y llegó al mismo número que ayer. Debajo del acantilado, el mar se plegaba contra las rocas con una paciencia que la asustaba. Escribió la cuenta en el libro, junto a la letra de su padre, y se preguntó si él también había esperado la campana que ya no sonaba. Cuando llegó la niebla, encendió la lámpara y miró el haz cruzar un agua que no devolvía nada.`,
        draft: `La guardiana del faro miraba el mar. Llegó la niebla, y la lámpara ardía para nadie. Escuchó el agua y oyó la voz de su padre.`,
        ropes: ['guardiana', 'gaviota', 'lámpara', 'padre'],
        rewrite: `Miraba el agua desde la torre. Llegó la noche, y la pequeña luz ardía para nadie. Escuchó y oyó una voz conocida.`
    },
    fr: {
        story: `La gardienne du phare compta les goélands une fois de plus et trouva le même nombre que la veille. Sous la falaise, la mer se repliait contre les rochers avec une patience qui l'effrayait. Elle écrivit le compte dans le registre, à côté de l'écriture de son père, et se demanda s'il avait lui aussi attendu la cloche qui ne sonnait plus. Quand le brouillard arriva, elle alluma la lampe et regarda le faisceau traverser une eau qui ne rendait rien.`,
        draft: `La gardienne du phare regardait la mer. Le brouillard est arrivé, et la lampe brûlait pour personne. Elle a écouté l'eau et entendu la voix de son père.`,
        ropes: ['gardien', 'goéland', 'lampe', 'père'],
        rewrite: `Elle regardait l'eau depuis la tour. La nuit est venue, et la petite lumière brûlait pour personne. Elle a écouté et entendu une voix qu'elle connaissait.`
    }
};

// In-memory stand-ins for the sign-in tests: node --test tests/auth.test.js
import { DatabaseSync } from 'node:sqlite';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { createAuth } from '../src/lib/auth.js';
import { authSchema } from '../src/lib/db/auth-schema.js';

export const ORIGIN = 'http://localhost:3000';
const SECRET = 'a-secret-that-is-long-enough-for-the-sign-in-tests';
const TABLES = [authSchema.user, authSchema.session, authSchema.account, authSchema.verification];

/**
 * The site's own auth module over an in-memory database that answers like
 * Cloudflare D1. The four tables come from the schema file the library's
 * generator wrote, with their unique columns enforced, so the tests cannot
 * drift from what the library expects.
 */
export async function setup(extraEnv = {}) {
    const sqlite = new DatabaseSync(':memory:');
    for (const table of TABLES) {
        const { name, columns } = getTableConfig(table);
        const definitions = columns.map(
            (column) =>
                `"${column.name}" ${column.getSQLType()}${column.primaryKey ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}`
        );
        sqlite.exec(`CREATE TABLE "${name}" (${definitions.join(', ')})`);
        for (const column of columns) {
            if (column.unique) sqlite.exec(`CREATE UNIQUE INDEX "${name}_${column.name}_unique" ON "${name}" ("${column.name}")`);
        }
    }

    // The library asks for the rows of an insert-with-returning as plain arrays.
    const d1 = {
        prepare(query) {
            const statement = sqlite.prepare(query);
            return {
                bind: (...args) => ({
                    run: async () => {
                        const result = statement.run(...args);
                        return {
                            success: true,
                            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) }
                        };
                    },
                    all: async () => ({ success: true, results: statement.all(...args), meta: {} }),
                    first: async () => statement.get(...args) ?? null,
                    raw: async () => statement.all(...args).map((row) => Object.values(row))
                })
            };
        },
        async batch(statements) {
            const out = [];
            for (const statement of statements) out.push(await statement.all());
            return out;
        }
    };

    const env = {
        DB: d1,
        BETTER_AUTH_SECRET: SECRET,
        BETTER_AUTH_URL: ORIGIN,
        EMAIL_FROM: 'oulipo.party <noreply@oulipo.party>',
        ...extraEnv
    };
    const auth = createAuth(env);
    const { internalAdapter } = await auth.$context;

    const usernames = () =>
        sqlite.prepare('SELECT "username" FROM "user" ORDER BY rowid').all().map((row) => row.username);
    const member = (id) => sqlite.prepare('SELECT * FROM "user" WHERE "id" = ?').get(id) ?? null;

    return { auth, env, internalAdapter, usernames, member };
}

/** A first sign-in through a provider: it hands over a display name and an address, never a username. */
export const arrives = (internalAdapter, { name, email }, provider = 'google') =>
    internalAdapter.createOAuthUser(
        { name, email: email.toLowerCase(), emailVerified: true },
        { providerId: provider, accountId: `account-of-${email}` }
    );

/** One request to the sign-in library's own endpoints, the way the pages send them. */
export async function request(auth, method, path, body, headers = {}) {
    const response = await auth.handler(
        new Request(ORIGIN + path, {
            method,
            headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        })
    );
    return {
        status: response.status,
        json: await response.json().catch(() => null),
        cookie: (response.headers.getSetCookie?.() ?? []).find((part) => part.includes('session'))?.split(';')[0]
    };
}

/** Run `run` with console.error captured, and return what it was told. */
export async function errorsLogged(run) {
    const lines = [];
    const original = console.error;
    console.error = (...args) => void lines.push(args.map(String).join(' '));
    try {
        await run();
    } finally {
        console.error = original;
    }
    return lines;
}

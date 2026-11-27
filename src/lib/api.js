// src/lib/api.js
// How a page talks to the games' endpoints: a POST when a body is given, a
// GET otherwise. A request that cannot be made or answered at all comes back
// as a failure, never as a thrown error.

/**
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<{ ok: boolean, payload: any }>}
 */
export async function post(path, body) {
    const hasBody = body !== undefined;
    try {
        const response = await fetch(path, {
            method: hasBody ? 'POST' : 'GET',
            headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
            body: hasBody ? JSON.stringify(body) : undefined
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        return { ok: response.ok, payload };
    } catch {
        return { ok: false, payload: null };
    }
}

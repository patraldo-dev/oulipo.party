// src/lib/server/day.js
// The site's day, for everything that happens "today": the prompt, Sappho's
// draft, each member's round. It turns over at midnight in Mexico City, where
// the game was born, so a day is a day everywhere at the same moment.

/** The date of right now in Mexico City, as YYYY-MM-DD. @returns {string} */
export function getToday() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    /** @type {Record<string, string>} */
    const by = {};
    for (const part of parts) if (part.type !== 'literal') by[part.type] = part.value;
    return `${by.year}-${by.month}-${by.day}`;
}

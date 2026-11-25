// Write the social providers' client ids into wrangler.jsonc: the first
// occurrence of a key is production, the second is staging. A value that is
// empty, or not given, leaves its line alone.
// Usage: node scripts/write-client-ids.mjs <wrangler.jsonc> [github] [github-staging] [discord]
import fs from 'node:fs';

const [file, github = '', githubStaging = '', discord = ''] = process.argv.slice(2);
let text = fs.readFileSync(file, 'utf8');

/** Replace the value of the n-th occurrence of a key. @param {string} key @param {string} value @param {number} which */
function set(key, value, which) {
    if (!value) return;
    let seen = 0;
    const pattern = new RegExp(`("${key}":\\s*)"[^"]*"`, 'g');
    text = text.replace(pattern, (match, before) => (seen++ === which ? `${before}${JSON.stringify(value)}` : match));
}

set('GITHUB_CLIENT_ID', github, 0);
set('GITHUB_CLIENT_ID', githubStaging, 1);
set('DISCORD_CLIENT_ID', discord, 0);
set('DISCORD_CLIENT_ID', discord, 1);
fs.writeFileSync(file, text);

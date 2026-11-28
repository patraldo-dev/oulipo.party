// Types for the duel's word engine and server flow.
//
// The modules themselves are plain JavaScript, like the rest of src/lib;
// they carry JSDoc against these declarations so that `svelte-check` can
// hold them to the same bar whatever a file happens to be named.

export type Lang = 'en' | 'es' | 'fr';
export type VerbPolicy = 'strict' | 'families';

/** Which verb policy a text is read under. */
export interface Policy {
    verbs: VerbPolicy;
}

/** One letter run of a text. Offsets index the normalized text. */
export interface Token {
    form: string;
    key: string;
    fn: boolean;
    content: boolean;
    start: number;
    end: number;
    line: number;
}

/** One word family of a text, with the surface forms it took. */
export interface WordType {
    key: string;
    display: string;
    forms: Record<string, number>;
    count: number;
    first: number;
}

export interface Analysis {
    lang: Lang;
    verbs: VerbPolicy;
    types: WordType[];
    vocabSize: number;
    contentTokens: number;
    functionTokens: number;
    shortTokens: number;
    totalTokens: number;
}

/** A marked word: where it sits and which family it belongs to. */
export interface Span {
    key: string;
    form: string;
    start: number;
    end: number;
    line: number;
}

/** One sent word and what it did to the draft. */
export interface Rope {
    key: string;
    forms: string[];
    hit: boolean;
    draftCount: number;
    draftForms: string[];
}

export interface Verdict {
    ropes: Rope[];
    invalid: string[];
    hits: number;
    misses: number;
    score: number;
    muzzlePct: number;
    draftTokens: number;
    draftTypes: number;
    storyTypes: number;
    storyTokens: number;
}

/** The contract every language file fulfils in the same shape. */
export interface LangConfig {
    code: Lang;
    minWordLength: number;
    apostrophe: 'split' | 'english';
    foldChars: Record<string, string> | null;
    functionSet: Set<string>;
    verbs: VerbPolicy;
    verbFamilyMap: Map<string, string>;
    fold: (form: string) => string | null;
    tiers: number[];
}

// ── Server side ────────────────────────────────────────────────────────

export type Row = Record<string, any>;

/** What the duel needs from D1 (and what the test double provides). */
export interface Statement {
    first(): Promise<Row | null>;
    all(): Promise<{ results?: Row[] }>;
    run(): Promise<{ meta?: { changes?: number } | void }>;
}
export interface Db {
    prepare(query: string): { bind(...args: unknown[]): Statement };
}

/** What the duel needs from the Workers AI binding. */
export interface Engine {
    run(
        model: string,
        input: {
            messages: { role: string; content: string }[];
            max_tokens: number;
            temperature: number;
        }
    ): Promise<{ response?: unknown }>;
}

export interface RewriteView {
    status: 'pending' | 'writing' | 'clean' | 'escaped';
    attempts: number;
    violations: string[];
    text: string;
    spans: Span[];
}

/** A side bet, as the result card shows it. */
export interface WagerOutcome {
    word: string;
    /** 'uses' — she used it — or 'absent' — she never did. */
    side: string;
    stake: number;
    /** 'open' until the round locks, then 'won', 'lost' or 'void'. */
    status: string;
    payout: number;
}

/** A round of the duel as the player sees it. */
export interface RoundView {
    id: string;
    date: string;
    locale: Lang;
    policy: Policy;
    story: string;
    ropes: Rope[];
    ropeCount: number;
    storyTypes: number;
    hits: number;
    misses: number;
    score: number;
    /** The pot the piece played for: its words ÷ 15. */
    pot: number;
    /** What one hit paid under the wager sent: pot ÷ sent. */
    pays: number;
    /** The craft grade 0–3, or null for a round the model never graded. */
    craft: number | null;
    /** Points paid back for hit words she smuggled into her rewrite; null until the rewrite settles. */
    jailbreak: number | null;
    /** The round's side bets, settled at lock. */
    wagers: WagerOutcome[];
    /** The member's purse when the view was made; null when nobody asked. */
    purse: number | null;
    /** Which named wager the count was, as the index into `duel.contract.0…5`. */
    contractName: number;
    muzzlePct: number;
    tier: number;
    draft: { text: string; tokens: number; spans: Span[] };
    rewrite: RewriteView;
}

export interface BoardRow {
    id: string;
    mine: boolean;
    name: string | null;
    score: number;
    muzzlePct: number;
    hits: number;
    misses: number;
    ropeCount: number;
    /** The member's best is shown; this is how many rounds they played. */
    rounds: number;
}

// ── The Siege ──────────────────────────────────────────────────────────

/** What a sent word was beside its hit or miss. A hit only one player sent is
 *  original; a hit every player sent is unanimous; a word among the prompt's
 *  own words earns no bonus either way. */
export type WordTag = 'plain' | 'original' | 'unanimous' | 'prompt';

export interface ScoredRope extends Rope {
    tag: WordTag;
}

/** One player's standing in a resolved siege. */
export interface SiegePlayer {
    userId: string;
    ropes: ScoredRope[];
    hits: number;
    misses: number;
    original: number;
    unanimous: number;
    bonus: number;
    score: number;
    storyTypes: number;
}

/** A resolved siege: every player's words against the same hidden piece. */
export interface SiegeScore {
    players: SiegePlayer[];
    /** Every distinct word anyone sent, and every form of them: what her rewrite has to avoid. */
    union: { keys: string[]; forms: string[] };
    /** The share of her piece that anyone's hits put off-limits. */
    muzzlePct: number;
}

/** One player as the room's table lists them. */
export interface SiegeRow {
    userId: string;
    name: string;
    mine: boolean;
    rank: number;
    hits: number;
    misses: number;
    original: number;
    unanimous: number;
    bonus: number;
    score: number;
}

/** What a player may see of a room. Before a round resolves nobody's words leave the server, and neither does the hidden piece. */
export interface SiegeView {
    code: string;
    locale: Lang;
    date: string;
    status: 'writing' | 'resolved' | 'lapsed';
    /** none: not counted in yet; the page's first ask does that. writing: in for
     *  today and not locked yet. locked: in, and locked. out: sitting out today.
     *  late: the round is over and this player never locked. */
    you: 'none' | 'writing' | 'locked' | 'out' | 'late';
    /** The day's prompt, once it has been written. */
    prompt: string;
    promptReady: boolean;
    /** How many have locked, and how many more are counted in for today. */
    locked: number;
    present: number;
    players: { userId: string; name: string; locked: boolean; mine: boolean }[];
    /** Only once the round has resolved. */
    result: {
        players: number;
        unionSize: number;
        muzzlePct: number;
        mine: SiegePlayer | null;
        table: SiegeRow[];
        draft: { text: string; spans: Span[] };
        rewrite: RewriteView;
    } | null;
    earlier: { date: string; status: 'resolved' | 'lapsed'; score: number | null }[];
}

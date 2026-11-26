<!-- src/routes/+page.svelte
     The home page is the duel.
     The solitaire duel. Sappho has written a hidden piece for today's
     prompt; the player writes one, sends some of its words against hers,
     and scores the ones her draft used. One duel a day. -->
<script>
    import { onMount, tick } from 'svelte';
    import { t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import { analyze, countWords, defaultPolicy, tierFor } from '#lib/oulipo/engine.js';
    import { DUEL } from '#lib/oulipo/duel-rules.js';
    import { fitPiece, IMPORT_TYPES, readPieceFile } from '#lib/import-text.js';

    /** @typedef {import('#lib/oulipo/types.js').Span} Span */
    /** @typedef {import('#lib/oulipo/types.js').RoundView} RoundView */
    /** @typedef {{ text: string, hit: boolean }} Part */
    /** @typedef {'unavailable' | 'signin' | 'preparing' | 'write' | 'locked'} Stage */
    /** @typedef {'' | 'prepare' | 'lock' | 'rewrite' | 'import'} Busy */

    let { data } = $props();

    // The page is rendered per visit, so reading the loader's answer once,
    // to start from, is exactly the intent.
    // svelte-ignore state_referenced_locally
    const start = {
        locale: data.locale,
        stage: /** @type {Stage} */ (
            data.unavailable
                ? 'unavailable'
                : data.round
                  ? 'locked'
                  : !data.signedIn
                    ? 'signin'
                    : data.prompt && data.draftReady
                      ? 'write'
                      : 'preparing'
        ),
        prompt: data.prompt?.text ?? '',
        round: /** @type {RoundView | null} */ (data.round ?? null),
        board: data.board ?? []
    };

    const lang = start.locale;
    const policy = defaultPolicy(lang);

    /** Fill {name} placeholders in an already translated string.
     *  @param {string} text @param {Record<string, string | number>} values */
    const fill = (text, values) =>
        Object.entries(values).reduce(
            (out, [name, value]) => out.split(`{${name}}`).join(String(value)),
            text
        );

    const HERE = '/';
    const LOGIN = `/sign-in?redirect=${encodeURIComponent(HERE)}`;
    const SIGNUP = `/sign-up?redirect=${encodeURIComponent(HERE)}`;

    /** What the server's error codes mean to a player. @type {Record<string, string>} */
    const ERROR_KEYS = {
        story_missing: 'duel.too_short',
        story_too_short: 'duel.too_short',
        story_too_long: 'duel.too_long',
        rope_not_in_story: 'duel.rope_bad',
        ropes_missing: 'duel.rope_bad',
        already_locked: 'duel.already_locked',
        draft_failed: 'duel.prepare_failed',
        prompt_failed: 'duel.prepare_failed',
        no_engine: 'duel.prepare_failed',
        rewrite_failed: 'duel.rewrite_failed'
    };

    // ── The piece: kept, brought in, and given room ──────────────────────

    /** Where the piece is kept in the member's own browser, per language. */
    const PIECE_KEY = `oulipo.party:piece:${start.locale}`;

    /** The piece kept on a former visit, or nothing. The server has none to read. */
    function savedPiece() {
        if (typeof localStorage === 'undefined') return '';
        try {
            return localStorage.getItem(PIECE_KEY) ?? '';
        } catch {
            // A browser that refuses storage keeps nothing; the rest works.
            return '';
        }
    }

    let stage = $state(start.stage);
    let prompt = $state(start.prompt);
    /** The piece: in the browser it starts as whatever was kept, whatever stage the
     *  page opens in, so that none is dropped because a prompt was not ready yet. */
    let story = $state(savedPiece());
    /** The box the piece is written in, and the picker that brings a file in. */
    let pieceBox = $state(/** @type {HTMLTextAreaElement | null} */ (null));
    let fileInput = $state(/** @type {HTMLInputElement | null} */ (null));
    /** True once the browser has taken the page over and filled the box. */
    let live = $state(false);
    let dragging = $state(false);
    /** How many words the last file brought in. */
    let importedWords = $state(0);
    /** Rope keys, in the order they will be sent. */
    let chosen = $state(/** @type {string[]} */ ([]));
    let target = $state(0);
    let round = $state(start.round);
    let board = $state(start.board);
    let busy = $state(/** @type {Busy} */ (''));
    /** i18n key of the last message shown. */
    let notice = $state('');
    /** Messages that are news, not a refusal: said in ink rather than in red. */
    const NEWS = new Set(['duel.copied', 'duel.imported', 'duel.import_cut']);
    const noticeIsNews = $derived(NEWS.has(notice));
    /** Passes Sappho has made so far, while the rewrite is still going. */
    let pass = $state(0);
    let pollTimer = $state(/** @type {number | undefined} */ (undefined));

    const candidates = $derived(analyze(story, lang, policy).types);
    const wordCount = $derived(countWords(story));
    const storyFits = $derived(wordCount >= DUEL.minStoryWords && wordCount <= DUEL.maxStoryWords);
    const chosenSet = $derived(new Set(chosen));

    /**
     * How much of the piece is being sent, as the game names it: a thread, a
     * cord, a rope, a cable, the whole coil. Each has its colour, shown as a
     * cord that thickens along the slider.
     */
    const TIER_COLORS = ['#bdbdbd', '#2e8b57', '#f7c948', '#e06a12', '#d13d3d'];
    /** What reads on each colour: dark on the grey and the yellow, white on the rest. */
    const TIER_INK = ['#121212', '#ffffff', '#121212', '#ffffff', '#ffffff'];
    const tier = $derived(candidates.length ? tierFor(lang, chosen.length, candidates.length) : 0);
    const tierColor = $derived(TIER_COLORS[tier]);
    const tierInk = $derived(TIER_INK[tier]);
    /** Where the slider stands along the piece, for the track it draws. */
    const sliderFill = $derived(candidates.length ? Math.round((target / candidates.length) * 100) : 0);

    // Kept as it is written, so a closed tab or a lost connection never costs
    // a piece. Nothing leaves the browser for it; it goes once the duel locks.
    $effect(() => {
        if (stage !== 'write') return;
        try {
            if (story) localStorage.setItem(PIECE_KEY, story);
            else localStorage.removeItem(PIECE_KEY);
        } catch {
            // A browser that refuses storage keeps nothing; the rest works.
        }
    });

    // Until the browser has taken the page over the box stays read-only: the
    // server cannot know a kept piece, so the page arrives with the box empty,
    // and letters typed into that empty box would take the kept piece's place.
    $effect(() => {
        tick().then(() => {
            live = true;
        });
    });

    // The box grows with the piece, from its nine lines upward.
    $effect(() => {
        void story;
        tick().then(() => {
            if (pieceBox) {
                pieceBox.style.height = 'auto';
                pieceBox.style.height = `${pieceBox.scrollHeight}px`;
            }
        });
    });

    /**
     * Bring a file's words in as the piece. A piece already in the box gives
     * way only on the member's word, as it does for starting over.
     * @param {File} file
     */
    async function importFile(file) {
        busy = 'import';
        notice = '';
        try {
            const whole = await readPieceFile(file);
            const { text, cut } = fitPiece(whole, DUEL.maxStoryWords, DUEL.maxStoryChars);
            importedWords = countWords(text);
            if (!importedWords) {
                notice = 'duel.import_empty';
                return;
            }
            if (story && !window.confirm($t('duel.import_replace_confirm'))) return;
            story = text;
            notice = cut ? 'duel.import_cut' : 'duel.imported';
        } catch (error) {
            console.error('[duel] import failed:', error instanceof Error ? error.message : error);
            notice = 'duel.import_failed';
        } finally {
            busy = '';
        }
    }

    /** @param {DragEvent} event */
    const carriesFiles = (event) => Boolean(event.dataTransfer?.types?.includes('Files'));

    /** @param {DragEvent} event */
    function dragOver(event) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        dragging = true;
    }

    /** @param {DragEvent} event */
    function drop(event) {
        dragging = false;
        if (!carriesFiles(event)) return;
        event.preventDefault();
        const file = event.dataTransfer?.files?.[0];
        if (file) importFile(file);
    }

    /** @param {Event} event */
    function fileChosen(event) {
        const input = /** @type {HTMLInputElement} */ (event.currentTarget);
        const file = input.files?.[0];
        if (file) importFile(file);
        // So that picking the same file twice still brings it in.
        input.value = '';
    }

    function startOver() {
        if (window.confirm($t('duel.clear_story_confirm'))) {
            story = '';
            notice = '';
        }
    }
    const rewriteStatus = $derived(round?.rewrite.status ?? 'pending');

    // Words the player took back out of the story cannot stay sent.
    $effect(() => {
        const alive = new Set(candidates.map((type) => type.key));
        const kept = chosen.filter((key) => alive.has(key));
        if (kept.length !== chosen.length) {
            chosen = kept;
            target = kept.length;
        }
    });

    /**
     * Call one of the duel's endpoints: a POST when a body is given, a GET
     * otherwise. A request that cannot be made or answered at all comes
     * back as a failure, never as a thrown error.
     * @param {string} path
     * @param {unknown} [body]
     * @returns {Promise<{ ok: boolean, payload: any }>}
     */
    async function call(path, body) {
        const hasBody = body !== undefined;
        try {
            const response = await fetch(`/api/duel/${path}`, {
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

    async function prepare() {
        busy = 'prepare';
        notice = '';
        const { ok, payload } = await call('prepare', {});
        busy = '';
        if (ok && payload?.prompt?.text && payload?.draftReady) {
            prompt = payload.prompt.text;
            stage = 'write';
        } else {
            notice = 'duel.prepare_failed';
        }
    }

    /** The slider sends the first `count` words of the piece. @param {number} count */
    function sendFirst(count) {
        target = count;
        chosen = candidates.slice(0, count).map((type) => type.key);
    }

    /** @param {string} key */
    function toggle(key) {
        chosen = chosen.includes(key) ? chosen.filter((other) => other !== key) : [...chosen, key];
        target = chosen.length;
    }

    async function lock() {
        busy = 'lock';
        notice = '';
        const { ok, payload } = await call('lock', { story, ropes: chosen });
        busy = '';
        if (ok && payload?.draft) {
            round = /** @type {RoundView} */ (payload);
            stage = 'locked';
            try {
                localStorage.removeItem(PIECE_KEY);
            } catch {
                // nothing was kept
            }
            rewrite();
            loadBoard();
        } else {
            notice = ERROR_KEYS[payload?.error] ?? 'duel.error';
        }
    }

    /**
     * Ask for the rewrite until it settles. Each request is one pass of
     * Sappho's; the page asks again a moment after an unfinished answer.
     * Bounded, so a round that never settles cannot keep a tab busy forever.
     * @param {number} tries
     */
    async function rewrite(tries = 0) {
        busy = 'rewrite';
        notice = '';
        const { ok, payload } = await call('rewrite', {});
        if (ok && payload?.draft) {
            round = /** @type {RoundView} */ (payload);
            pass = round.rewrite.attempts;
            const status = round.rewrite.status;
            if (status === 'clean' || status === 'escaped') {
                busy = '';
                return;
            }
            if (tries < 30) {
                pollTimer = window.setTimeout(() => rewrite(tries + 1), 1500);
                return;
            }
        }
        // A request that failed or never finished is the card's to explain:
        // it says the rewrite did not come through, and offers to ask again.
        busy = '';
        pass = 0;
    }

    async function loadBoard() {
        const { ok, payload } = await call('board');
        if (ok) board = payload.board ?? [];
    }

    /**
     * Split a text into plain and marked parts, at the server's positions.
     * @param {string} text @param {Span[]} spans @returns {Part[]}
     */
    function segments(text, spans) {
        /** @type {Part[]} */
        const parts = [];
        /** @param {number} start @param {number} end @param {boolean} hit */
        const push = (start, end, hit) => {
            if (end > start) parts.push({ text: text.slice(start, end), hit });
        };
        let at = 0;
        for (const span of spans) {
            push(at, span.start, false);
            push(span.start, span.end, true);
            at = span.end;
        }
        push(at, text.length, false);
        return parts;
    }

    async function share() {
        if (!round) return;
        const marks = round.ropes.map((rope) => (rope.hit ? '🟢' : '🔴')).join('');
        const text = [
            `${$t('duel.title')} · ${round.date}`,
            marks,
            `🟢 ${round.hits}  🔴 ${round.misses}  ⛔ ${round.muzzlePct}%`,
            `${location.origin}${HERE}`
        ].join('\n');
        try {
            await navigator.clipboard.writeText(text);
            notice = 'duel.copied';
        } catch {
            notice = 'duel.copy_failed';
        }
    }

    onMount(() => {
        if (stage === 'preparing') prepare();
        // Back to a duel whose rewrite is still being asked for elsewhere.
        else if (stage === 'locked' && rewriteStatus !== 'clean' && rewriteStatus !== 'escaped') rewrite();
        return () => window.clearTimeout(pollTimer);
    });
</script>

<svelte:head>
    <title>{$t('duel.title')} — oulipo.party</title>
</svelte:head>

<div class="duel-page">
    <header class="head">
        <GameIcon icon="duel" size={96} />
        <div>
            <h1>{$t('duel.title')}</h1>
            <p class="tagline">{$t('duel.tagline')}</p>
        </div>
    </header>

    <p class="notice" class:news={noticeIsNews} aria-live="polite">
        {notice
            ? fill($t(notice), {
                  n: notice === 'duel.too_long'
                      ? DUEL.maxStoryWords
                      : notice === 'duel.imported' || notice === 'duel.import_cut'
                        ? importedWords
                        : DUEL.minStoryWords
              })
            : ''}
    </p>

    {#if stage === 'unavailable'}
        <section class="glass-surface card center"><p>{$t('duel.unavailable')}</p></section>
    {:else if stage === 'signin'}
        <section class="glass-surface card">
            <ol class="steps">
                <li><span class="step s1">1</span><p>{$t('duel.rule_1')}</p></li>
                <li><span class="step s2">2</span><p>{$t('duel.rule_2')}</p></li>
                <li><span class="step s3">3</span><p>{$t('duel.rule_3')}</p></li>
            </ol>
            <p class="note">{$t('duel.note')}</p>
        </section>
        <section class="glass-surface card center invite">
            <p class="lead">{$t('duel.signin')}</p>
            <div class="row">
                <a class="btn-primary big" href={LOGIN}>{$t('nav.signin')}</a>
                <a class="btn-secondary big" href={SIGNUP}>{$t('nav.signup')}</a>
            </div>
        </section>
    {:else if stage === 'preparing'}
        <section class="glass-surface card center">
            {#if busy === 'prepare'}
                <p class="waiting"><span class="dot" aria-hidden="true"></span>{$t('duel.preparing')}</p>
            {:else}
                <button class="btn-primary" type="button" onclick={prepare}>{$t('duel.retry')}</button>
            {/if}
        </section>
    {:else if stage === 'write'}
        <section class="glass-surface card">
            <h2><GameIcon icon="prompt" />{$t('duel.prompt_label')}</h2>
            <p class="prompt">{prompt}</p>
            <details class="howto" open>
                <summary>{$t('duel.how_title')}</summary>
                <ol class="steps">
                    <li><span class="step s1">1</span><p>{$t('duel.rule_1')}</p></li>
                    <li><span class="step s2">2</span><p>{$t('duel.rule_2')}</p></li>
                    <li><span class="step s3">3</span><p>{$t('duel.rule_3')}</p></li>
                </ol>
                <p class="note">{$t('duel.note')}</p>
            </details>
        </section>

        <section class="glass-surface card">
            <h2><GameIcon icon="write" />{$t('duel.story_label')}</h2>
            <div
                class="box"
                class:dragging
                role="group"
                aria-label={$t('duel.story_label')}
                ondragover={dragOver}
                ondragleave={() => (dragging = false)}
                ondrop={drop}
            >
                <textarea
                    bind:this={pieceBox}
                    bind:value={story}
                    oninput={() => (notice = '')}
                    readonly={!live}
                    maxlength={DUEL.maxStoryChars}
                    rows="9"
                    placeholder={$t('duel.placeholder')}
                    disabled={busy !== ''}
                ></textarea>
                {#if dragging}<p class="drop-note">{$t('duel.drop_here')}</p>{/if}
            </div>
            <div class="tools">
                <p class="count" class:off={!storyFits && wordCount > 0}>
                    {#if wordCount < DUEL.minStoryWords}
                        {fill($t('duel.too_short'), { n: DUEL.minStoryWords })}
                    {:else if wordCount > DUEL.maxStoryWords}
                        {fill($t('duel.too_long'), { n: DUEL.maxStoryWords })}
                    {:else}
                        {fill($t('duel.words'), { n: wordCount })}
                    {/if}
                </p>
                <div class="tools-actions">
                    {#if story}<span class="kept">{$t('duel.autosave_hint')}</span>{/if}
                    {#if story}
                        <button class="btn-secondary small" type="button" onclick={startOver} disabled={busy !== ''}>{$t('duel.clear_story')}</button>
                    {/if}
                    <button class="btn-secondary small" type="button" onclick={() => fileInput?.click()} disabled={busy !== ''}>
                        {$t('duel.import')}
                    </button>
                </div>
            </div>
            <p class="note">{$t('duel.import_hint')}</p>
            <input
                bind:this={fileInput}
                class="file"
                type="file"
                accept={IMPORT_TYPES}
                onchange={fileChosen}
                aria-hidden="true"
                tabindex="-1"
            />
        </section>

        {#if candidates.length}
            <section class="glass-surface card">
                <h2><GameIcon icon="send" />{$t('duel.choose_title')}</h2>
                <p class="note">{$t('duel.choose_body')}</p>
                <input
                    class="slider"
                    type="range"
                    min="0"
                    max={candidates.length}
                    value={target}
                    oninput={(event) => sendFirst(Number(event.currentTarget.value))}
                    aria-label={$t('duel.choose_title')}
                    disabled={busy !== ''}
                    style="--tier: {tierColor}; --fill: {sliderFill}%"
                />
                <div class="cord" aria-hidden="true">
                    {#each TIER_COLORS as color, i (i)}
                        <span class="cord-part" class:lit={tier >= i} style="background: {color}"></span>
                    {/each}
                </div>
                <div class="row wrap">
                    <span class="count">{fill($t('duel.ropes_count'), { n: chosen.length, total: candidates.length })}</span>
                    {#if chosen.length}
                        <span class="tier-pill" style="background: {tierColor}; color: {tierInk}">{$t(`duel.tier.${tier}`)}</span>
                    {/if}
                    <button class="btn-secondary small" type="button" onclick={() => sendFirst(candidates.length)} disabled={busy !== '' || target === candidates.length}>
                        {$t('duel.send_all')}
                    </button>
                    <button class="btn-secondary small" type="button" onclick={() => sendFirst(0)} disabled={busy !== '' || target === 0}>
                        {$t('duel.clear')}
                    </button>
                </div>
                <div class="chips">
                    {#each candidates as type (type.key)}
                        <button
                            class="chip"
                            class:on={chosenSet.has(type.key)}
                            type="button"
                            aria-pressed={chosenSet.has(type.key)}
                            disabled={busy !== ''}
                            title={type.count > 1 ? `×${type.count}` : ''}
                            onclick={() => toggle(type.key)}
                        >{type.display}</button>
                    {/each}
                </div>
                <div class="row">
                    <button class="btn-primary big" type="button" onclick={lock} disabled={busy !== '' || !storyFits || chosen.length < DUEL.minRopes}>
                        {busy === 'lock' ? '…' : $t('duel.lock')}
                    </button>
                    <span class="note">{$t('duel.lock_hint')}</span>
                </div>
            </section>
        {/if}
    {:else if stage === 'locked' && round}
        <section class="glass-surface card">
            <p class="locked"><GameIcon icon="score" size={36} />{$t('duel.locked_notice')}</p>
            <dl class="tiles">
                <div class="tile score">
                    <dt>{$t('duel.score')}</dt>
                    <dd>{round.score > 0 ? '+' : ''}{round.score}</dd>
                </div>
                <div class="tile hit">
                    <dt>{$t('duel.hits')}</dt>
                    <dd class="hit">{round.hits}</dd>
                </div>
                <div class="tile miss">
                    <dt>{$t('duel.misses')}</dt>
                    <dd class="miss">{round.misses}</dd>
                </div>
                <div class="tile muzzle">
                    <dt>{$t('duel.muzzle')}</dt>
                    <dd>{round.muzzlePct}%</dd>
                </div>
            </dl>
            <p class="caption">
                {round.muzzlePct > 0
                    ? fill($t('duel.muzzle_line'), { pct: round.muzzlePct })
                    : $t('duel.muzzle_none')}
            </p>
            <p class="caption">{fill($t('duel.sent_line'), { tier: $t(`duel.tier.${round.tier}`) })}</p>
            <div class="row">
                <button class="btn-secondary small" type="button" onclick={share}>{$t('duel.share')}</button>
            </div>
            <h3><GameIcon icon="send" size={30} />{$t('duel.your_words')}</h3>
            <div class="chips">
                {#each round.ropes as rope (rope.key)}
                    <span class="chip static" class:hit={rope.hit} class:miss={!rope.hit}>{rope.forms[0]}</span>
                {/each}
            </div>
        </section>

        <section class="glass-surface card">
            <h2><GameIcon icon="sappho" />{$t('duel.she_wrote')}</h2>
            <p class="note">{$t('duel.she_wrote_note')}</p>
            <p class="piece">{#each segments(round.draft.text, round.draft.spans) as part, i (i)}{#if part.hit}<mark class="hit">{part.text}</mark>{:else}{part.text}{/if}{/each}</p>
        </section>

        <section class="glass-surface card">
            {#if rewriteStatus === 'clean' || rewriteStatus === 'escaped'}
                <h2><GameIcon icon="sappho" />{$t('duel.rewrite_title')}</h2>
                {#if rewriteStatus === 'clean'}
                    <p class="note">{$t('duel.clean')}</p>
                {:else}
                    <p class="note">{$t('duel.escaped')}</p>
                    <div class="chips tight">
                        {#each round.rewrite.violations as word (word)}<span class="chip static miss">{word}</span>{/each}
                    </div>
                {/if}
                {#if round.rewrite.attempts > 1}
                    <p class="note muted">{fill($t('duel.attempts'), { n: round.rewrite.attempts })}</p>
                {/if}
                <p class="piece">{#each segments(round.rewrite.text, round.rewrite.spans) as part, i (i)}{#if part.hit}<mark class="miss">{part.text}</mark>{:else}{part.text}{/if}{/each}</p>
            {:else if busy === 'rewrite'}
                <p class="waiting">
                    <span class="dot" aria-hidden="true"></span>
                    {pass > 0
                        ? fill($t('duel.rewrite_pass'), { n: pass, total: DUEL.rewriteAttempts })
                        : $t('duel.rewriting')}
                </p>
            {:else}
                <p>{$t('duel.rewrite_failed')}</p>
                <button class="btn-primary" type="button" onclick={() => rewrite()}>{$t('duel.ask_rewrite')}</button>
            {/if}
        </section>
    {/if}

    {#if stage === 'locked' && round}
        <section class="glass-surface card">
            <h2><GameIcon icon="board" />{$t('duel.board_title')}</h2>
            {#if board.length === 0}
                <p class="note">{$t('duel.board_empty')}</p>
            {:else}
                <ol class="board">
                    {#each board as row, i (row.id)}
                        <li class:mine={row.mine}>
                            <span class="rank">{i + 1}</span>
                            <span class="name">
                                {row.name ?? '·'}
                                {#if row.mine}<small> · {$t('duel.you')}</small>{/if}
                            </span>
                            <span class="marks">
                                <i class="mark hit"></i>{row.hits}
                                <i class="mark miss"></i>{row.misses}
                            </span>
                            <span class="pts">{row.score > 0 ? '+' : ''}{row.score}</span>
                        </li>
                    {/each}
                </ol>
            {/if}
        </section>
    {/if}
</div>

<style>
    /* Highlights follow the theme; the tiles keep the game's own colours. */
    .duel-page {
        --hit: #2e8b57;
        --hit-bg: rgba(46, 139, 87, 0.14);
        --miss: #d13d3d;
        --miss-bg: rgba(209, 61, 61, 0.12);
        max-width: 760px;
        margin: 0 auto;
        padding: 2.25rem 1.25rem 3rem;
    }
    :global(html[data-theme='dark']) .duel-page {
        --hit: #6fd39a;
        --hit-bg: rgba(111, 211, 154, 0.18);
        --miss: #f08c8c;
        --miss-bg: rgba(240, 140, 140, 0.18);
    }

    /* ── The game's title ─────────────────────────────────────────── */

    .head {
        display: flex;
        align-items: center;
        gap: 1.25rem;
        margin-bottom: 1.75rem;
    }
    h1 {
        font-family: var(--font-display);
        font-size: clamp(2.6rem, 8vw, 3.75rem);
        line-height: 0.95;
        font-weight: 900;
        letter-spacing: -0.035em;
        color: var(--text);
        margin: 0 0 0.6rem;
    }
    .tagline {
        color: var(--text-dim);
        font-size: 1.05rem;
        font-weight: 500;
        line-height: 1.45;
        margin: 0;
        max-width: 36ch;
    }
    h2 {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-family: var(--font-heading);
        font-weight: 800;
        font-size: 1.4rem;
        letter-spacing: -0.02em;
        color: var(--text);
        margin: 0 0 0.9rem;
    }
    h3 {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        font-family: var(--font-heading);
        font-weight: 800;
        font-size: 1.05rem;
        color: var(--text);
        margin: 1.75rem 0 0.25rem;
    }

    .card {
        padding: 1.6rem 1.75rem;
        margin-bottom: 1.1rem;
    }
    .card.center {
        text-align: center;
        padding: 2.25rem 1.75rem;
    }
    .invite {
        background: var(--surface-raised);
    }
    .lead {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 1.3rem;
        letter-spacing: -0.015em;
        color: var(--text);
        margin: 0 0 1.5rem;
    }
    .prompt {
        font-family: var(--font-reading);
        font-size: 1.5rem;
        line-height: 1.4;
        color: var(--text);
        margin: 0;
    }
    .note {
        color: var(--text-dim);
        font-size: 0.92rem;
        line-height: 1.55;
        margin: 0.75rem 0 0;
    }
    .notice {
        min-height: 1.5rem;
        margin: 0 0 0.75rem;
        color: var(--miss);
        font-size: 0.92rem;
        font-weight: 600;
        line-height: 1.5;
        text-align: center;
    }
    .notice.news {
        color: var(--text);
    }

    /* ── The three steps ──────────────────────────────────────────── */

    .steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 1rem;
    }
    .steps li {
        display: grid;
        grid-template-columns: 2.2rem 1fr;
        gap: 0.9rem;
        align-items: start;
        color: var(--text);
        line-height: 1.55;
        font-size: 1rem;
    }
    .steps p {
        margin: 0.1rem 0 0;
    }
    .step {
        width: 2.2rem;
        height: 2.2rem;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 1.05rem;
        line-height: 1;
        color: #ffffff;
    }
    .s1 {
        background: #f7c948;
        color: #121212;
    }
    .s2 {
        background: #178a8a;
    }
    .s3 {
        background: #7c5cd6;
    }
    .howto {
        margin-top: 1.25rem;
        border-top: 1px solid var(--border);
        padding-top: 1rem;
    }
    .howto summary {
        cursor: pointer;
        font-weight: 700;
        font-size: 0.95rem;
        color: var(--accent);
        list-style: none;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
    }
    .howto summary::-webkit-details-marker {
        display: none;
    }
    .howto summary::before {
        content: '';
        width: 0.55rem;
        height: 0.55rem;
        border-right: 2.5px solid currentColor;
        border-bottom: 2.5px solid currentColor;
        transform: rotate(45deg);
        transition: transform 0.15s;
        margin-bottom: 0.15rem;
    }
    .howto[open] summary::before {
        transform: rotate(225deg);
        margin-bottom: 0;
        margin-top: 0.2rem;
    }
    .howto[open] summary {
        margin-bottom: 1rem;
    }

    /* ── The piece ────────────────────────────────────────────────── */

    textarea {
        width: 100%;
        resize: vertical;
        min-height: 12rem;
        line-height: 1.7;
        font-family: var(--font-reading);
        font-size: 1.1rem;
        color: var(--text);
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: 12px;
        padding: 1rem 1.1rem;
    }
    textarea:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 1px;
        border-color: var(--accent);
    }
    .count {
        color: var(--text);
        font-size: 0.9rem;
        font-weight: 700;
        margin-top: 0.6rem;
    }
    .count.off {
        color: var(--miss);
    }

    /* ── The box, the tools beside the count, the picker ────────────── */

    .box {
        position: relative;
    }
    .box.dragging textarea {
        border-color: var(--accent);
        border-style: dashed;
    }
    .drop-note {
        position: absolute;
        inset: 0;
        margin: 0;
        display: grid;
        place-items: center;
        border-radius: 12px;
        background: color-mix(in srgb, var(--bg) 86%, transparent);
        color: var(--accent);
        font-weight: 700;
        pointer-events: none;
    }
    .tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem 1rem;
    }
    .tools-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.6rem;
    }
    .kept {
        color: var(--text-muted);
        font-size: 0.82rem;
        font-weight: 500;
    }
    /* The picker itself stays out of sight; its button opens it. */
    .file {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        overflow: hidden;
        pointer-events: none;
    }

    .row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        margin-top: 1rem;
    }
    .card.center .row {
        justify-content: center;
    }
    .row .count,
    .tools .count {
        margin-top: 0;
    }
    .btn-secondary.small {
        padding: 0.45rem 1rem;
        font-size: 0.88rem;
        border-width: 1.5px;
    }
    .btn-primary:disabled,
    .btn-secondary:disabled,
    .chip:disabled,
    .slider:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        transform: none;
    }

    /* ── The words sent: the slider and its cord ───────────────────── */

    /* The slider is drawn here rather than left to the browser, so that its
       track takes the colour of the cord: filled as far as it stands (--fill)
       in the tier's colour (--tier), empty beyond. */
    .slider {
        width: 100%;
        height: 2rem;
        margin: 0;
        padding: 0;
        background: transparent;
        border: none;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
    }
    .slider::-webkit-slider-runnable-track {
        height: 0.6rem;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: linear-gradient(to right, var(--tier) 0 var(--fill), var(--surface-raised) var(--fill) 100%);
    }
    .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 1.5rem;
        height: 1.5rem;
        margin-top: calc((0.6rem - 1.5rem) / 2 - 1px);
        border-radius: 50%;
        background: #ffffff;
        border: 2.5px solid var(--text);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
    .slider::-moz-range-track {
        height: 0.6rem;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface-raised);
    }
    .slider::-moz-range-progress {
        height: 0.6rem;
        border-radius: 999px;
        background: var(--tier);
    }
    .slider::-moz-range-thumb {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        background: #ffffff;
        border: 2.5px solid var(--text);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
    .slider:focus-visible {
        outline: none;
    }
    .slider:focus-visible::-webkit-slider-thumb {
        outline: 3px solid var(--accent);
        outline-offset: 3px;
    }
    .slider:focus-visible::-moz-range-thumb {
        outline: 3px solid var(--accent);
        outline-offset: 3px;
    }
    /* Five lengths of cord, thread to coil, each thicker than the last. */
    .cord {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 1.1rem;
        margin: 0.1rem 0 0.9rem;
    }
    .cord-part {
        flex: 1;
        border-radius: 999px;
        opacity: 0.16;
        transition: opacity 0.15s;
    }
    .cord-part:nth-child(1) {
        height: 30%;
    }
    .cord-part:nth-child(2) {
        height: 47%;
    }
    .cord-part:nth-child(3) {
        height: 65%;
    }
    .cord-part:nth-child(4) {
        height: 82%;
    }
    .cord-part:nth-child(5) {
        height: 100%;
    }
    .cord-part.lit {
        opacity: 1;
    }
    .tier-pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 0.3rem 0.85rem;
        font-size: 0.88rem;
        font-weight: 700;
        line-height: 1.2;
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1.25rem;
    }
    .chip {
        border: 1.5px solid var(--border);
        border-radius: 10px;
        background: var(--surface);
        color: var(--text);
        font-family: var(--font-body);
        font-weight: 600;
        font-size: 0.97rem;
        padding: 0.42rem 0.85rem;
        cursor: pointer;
        transition:
            background 0.15s,
            border-color 0.15s,
            color 0.15s;
    }
    .chip:hover:not(:disabled, .static) {
        border-color: var(--accent);
        color: var(--accent);
    }
    .chip.on {
        background: var(--accent-bg);
        border-color: var(--accent);
        color: var(--accent);
    }
    .chip.static {
        cursor: default;
    }
    /* A hit and a miss are tiles of the game's green and red. */
    .chip.hit {
        background: #2e8b57;
        border-color: #2e8b57;
        color: #ffffff;
    }
    .chip.miss {
        background: #d13d3d;
        border-color: #d13d3d;
        color: #ffffff;
        text-decoration: line-through;
    }

    /* ── The score ────────────────────────────────────────────────── */

    .locked {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        color: var(--text);
        font-size: 1rem;
        font-weight: 700;
        margin: 0 0 1.25rem;
    }
    .tiles {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.75rem;
        margin: 0;
    }
    .tile {
        background: var(--contrast-bg);
        color: var(--contrast-text);
        border-radius: 14px;
        padding: 0.85rem 0.5rem 0.75rem;
        text-align: center;
        box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.14);
    }
    .tile.hit {
        background: #2e8b57;
        color: #ffffff;
    }
    .tile.miss {
        background: #d13d3d;
        color: #ffffff;
    }
    .tile.muzzle {
        background: #2b59ff;
        color: #ffffff;
    }
    .tile dt {
        font-size: 0.7rem;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.85;
    }
    .tile dd {
        font-family: var(--font-display);
        font-size: 2rem;
        font-weight: 900;
        line-height: 1.1;
        letter-spacing: -0.02em;
        margin-top: 0.2rem;
    }
    .tile.hit dd,
    .tile.miss dd {
        color: #ffffff;
    }
    .hit {
        color: var(--hit);
    }
    .miss {
        color: var(--miss);
    }
    .caption {
        color: var(--text);
        font-size: 0.98rem;
        line-height: 1.55;
        margin-top: 0.85rem;
    }
    .note.muted {
        color: var(--text-muted);
        font-size: 0.85rem;
        margin-top: 0.5rem;
    }
    .chips.tight {
        margin-top: 0.6rem;
        gap: 0.4rem;
    }
    .chips.tight .chip {
        font-size: 0.88rem;
        padding: 0.25rem 0.7rem;
    }

    /* ── What was written ─────────────────────────────────────────── */

    .piece {
        font-family: var(--font-reading);
        white-space: pre-wrap;
        line-height: 1.8;
        font-size: 1.1rem;
        color: var(--text);
        overflow-wrap: anywhere;
        margin: 0;
    }
    mark {
        background: #2e8b57;
        color: #ffffff;
        border-radius: 4px;
        padding: 0 0.14em;
        font-weight: 600;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
    }
    mark.miss {
        background: #d13d3d;
    }

    .waiting {
        display: flex;
        gap: 0.6rem;
        align-items: center;
        justify-content: center;
        color: var(--text-dim);
        font-weight: 500;
    }
    .dot {
        width: 0.7rem;
        height: 0.7rem;
        border-radius: 50%;
        background: var(--accent);
        animation: breathe 1.2s ease-in-out infinite;
    }
    @keyframes breathe {
        0%,
        100% {
            opacity: 0.25;
        }
        50% {
            opacity: 1;
        }
    }

    /* ── The day's board ──────────────────────────────────────────── */

    .board {
        list-style: none;
        margin: 0;
    }
    .board li {
        display: grid;
        grid-template-columns: 1.9rem 1fr auto auto;
        gap: 0.75rem;
        align-items: center;
        padding: 0.6rem 0.6rem;
        border-bottom: 1px solid var(--border);
        color: var(--text);
        font-size: 0.97rem;
        font-weight: 500;
    }
    .board li:last-child {
        border-bottom: none;
    }
    .board li.mine {
        background: var(--accent-bg);
        border-radius: 10px;
        font-weight: 700;
    }
    .rank {
        width: 1.9rem;
        height: 1.9rem;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--surface-raised);
        color: var(--text);
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 0.9rem;
        line-height: 1;
    }
    /* First, second and third: gold, silver, bronze. */
    .board li:nth-child(1) .rank {
        background: #f7c948;
        color: #121212;
    }
    .board li:nth-child(2) .rank {
        background: #d4d4d4;
        color: #121212;
    }
    .board li:nth-child(3) .rank {
        background: #e9a570;
        color: #121212;
    }
    .name {
        overflow-wrap: anywhere;
    }
    .name small {
        color: var(--accent);
        font-weight: 700;
    }
    .marks {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.9rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .mark {
        display: inline-block;
        width: 0.65rem;
        height: 0.65rem;
        border-radius: 50%;
    }
    .mark.miss {
        margin-left: 0.5rem;
    }
    .mark.hit {
        background: #2e8b57;
    }
    .mark.miss {
        background: #d13d3d;
    }
    .pts {
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 1.05rem;
        color: var(--text);
        font-variant-numeric: tabular-nums;
    }

    @media (max-width: 520px) {
        .duel-page {
            padding-top: 1.5rem;
        }
        .head {
            gap: 0.9rem;
        }
        .tiles {
            grid-template-columns: repeat(2, 1fr);
        }
        .card {
            padding: 1.35rem 1.2rem;
        }
        .board li {
            grid-template-columns: 1.9rem 1fr auto;
        }
        .marks {
            grid-column: 2 / 3;
            grid-row: 2;
            justify-self: start;
            margin-top: -0.3rem;
        }
        .pts {
            grid-column: 3;
            grid-row: 1 / 3;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .dot {
            animation: none;
        }
        .cord-part,
        .chip,
        .howto summary::before {
            transition: none;
        }
    }
</style>

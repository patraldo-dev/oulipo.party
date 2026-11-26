<!-- src/lib/components/WordPicker.svelte
     Choosing which of the piece's words to send against her: a slider along a
     cord that thickens from a thread to the whole coil, and the words
     themselves to tap. Choosing is all that happens here; the game's own
     button, passed in below, is what sends them. -->
<script>
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import { tierFor } from '#lib/oulipo/engine.js';

    /**
     * @type {{
     *   lang: import('#lib/oulipo/types.js').Lang,
     *   candidates: import('#lib/oulipo/types.js').WordType[],
     *   chosen?: string[],
     *   disabled?: boolean,
     *   children?: import('svelte').Snippet
     * }}
     */
    let { lang, candidates, chosen = $bindable(/** @type {string[]} */ ([])), disabled = false, children } = $props();

    /** Where the slider stands. */
    let target = $state(0);
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

    // Words the player took back out of the piece cannot stay chosen.
    $effect(() => {
        const alive = new Set(candidates.map((type) => type.key));
        const kept = chosen.filter((key) => alive.has(key));
        if (kept.length !== chosen.length) {
            chosen = kept;
            target = kept.length;
        }
    });

    /** The slider picks the first `count` words of the piece. @param {number} count */
    function sendFirst(count) {
        target = count;
        chosen = candidates.slice(0, count).map((type) => type.key);
    }

    /** @param {string} key */
    function toggle(key) {
        chosen = chosen.includes(key) ? chosen.filter((other) => other !== key) : [...chosen, key];
        target = chosen.length;
    }
</script>

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
        {disabled}
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
        <button class="btn-secondary small" type="button" onclick={() => sendFirst(candidates.length)} disabled={disabled || target === candidates.length}>
            {$t('duel.send_all')}
        </button>
        <button class="btn-secondary small" type="button" onclick={() => sendFirst(0)} disabled={disabled || target === 0}>
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
                {disabled}
                title={type.count > 1 ? `×${type.count}` : ''}
                onclick={() => toggle(type.key)}
            >{type.display}</button>
        {/each}
    </div>
    {@render children?.()}
</section>

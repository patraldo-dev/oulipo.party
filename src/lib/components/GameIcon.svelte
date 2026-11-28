<script>
    /**
     * One of the game's tiles: a flat square of one bright colour with a
     * simple glyph drawn as geometry, so it stays crisp from a phone up to
     * the hero. Decorative unless a label is given: the heading beside it
     * says what it is.
     * @type {{ icon: 'duel' | 'siege' | 'prompt' | 'write' | 'send' | 'score' | 'sappho' | 'board' | 'coin', size?: number, label?: string }}
     */
    let { icon, size = 40, label = '' } = $props();

    /** The colour of each tile, and the colour of its glyph. */
    const TILES = {
        /** The Duel: your words against hers, bubble to bubble. */
        duel: ['#2b59ff', '#ffffff'],
        /** The Siege: many voices against hers. */
        siege: ['#b3261e', '#ffffff'],
        /** Today's prompt: a spark. */
        prompt: ['#f7c948', '#121212'],
        /** Your piece: the pen. */
        write: ['#178a8a', '#ffffff'],
        /** The words you send. */
        send: ['#e06a12', '#ffffff'],
        /** The score. */
        score: ['#7c5cd6', '#ffffff'],
        /** Sappho's own writing. */
        sappho: ['#d13f88', '#ffffff'],
        /** The day's board. */
        board: ['#121212', '#ffffff'],
        /** The purse: banked points. */
        coin: ['#178a3c', '#ffffff']
    };
    const [background, glyph] = $derived(TILES[icon]);
    const across = $derived(Math.round(size * 0.72));
</script>

<span
    class="tile"
    style="width: {size}px; height: {size}px; background: {background}; color: {glyph}; border-radius: {Math.round(size * 0.26)}px"
    role={label ? 'img' : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : 'true'}
>
    <svg viewBox="0 0 64 64" width={across} height={across} fill="none">
        {#if icon === 'duel'}
            <rect x="8" y="12" width="35" height="25" rx="7" fill="currentColor" />
            <path d="M16 36 L11 47 L24 37 Z" fill="currentColor" />
            <circle cx="18" cy="24.5" r="2.7" fill={background} />
            <circle cx="25.5" cy="24.5" r="2.7" fill={background} />
            <circle cx="33" cy="24.5" r="2.7" fill={background} />
            <rect x="26" y="28" width="30" height="21" rx="6" fill={background} stroke="currentColor" stroke-width="3.5" />
            <circle cx="34" cy="38.5" r="2.2" fill="currentColor" />
            <circle cx="41" cy="38.5" r="2.2" fill="currentColor" />
            <circle cx="48" cy="38.5" r="2.2" fill="currentColor" />
        {:else if icon === 'siege'}
            <rect x="28" y="8" width="30" height="18" rx="6" fill="currentColor" />
            <path d="M50 25 L55 33 L44 26 Z" fill="currentColor" />
            <circle cx="38" cy="17" r="2.4" fill={background} />
            <circle cx="45" cy="17" r="2.4" fill={background} />
            <circle cx="52" cy="17" r="2.4" fill={background} />
            <rect x="6" y="24" width="30" height="20" rx="6" fill="currentColor" />
            <path d="M14 43 L10 52 L23 44 Z" fill="currentColor" />
            <circle cx="16" cy="34" r="2.6" fill={background} />
            <circle cx="24" cy="34" r="2.6" fill={background} />
            <circle cx="32" cy="34" r="2.6" fill={background} />
            <rect x="30" y="38" width="27" height="16" rx="5.5" fill={background} stroke="currentColor" stroke-width="3.5" />
            <circle cx="39" cy="46" r="2.1" fill="currentColor" />
            <circle cx="46" cy="46" r="2.1" fill="currentColor" />
            <circle cx="53" cy="46" r="2.1" fill="currentColor" />
        {:else if icon === 'prompt'}
            <path d="M32 9 C34.6 25 39 29.4 55 32 C39 34.6 34.6 39 32 55 C29.4 39 25 34.6 9 32 C25 29.4 29.4 25 32 9 Z" fill="currentColor" />
        {:else if icon === 'write'}
            <path d="M15 49 L17 41 L39 19 L45 25 L23 47 Z" fill="currentColor" />
            <path d="M35 23 L41 29" stroke={background} stroke-width="2.5" />
        {:else if icon === 'send'}
            <path d="M12 32 H48 M36 19 L49 32 L36 45" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
        {:else if icon === 'score'}
            <path d="M14 34 L26 46 L50 18" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" />
        {:else if icon === 'sappho'}
            <path d="M16 20 H29 V33 C29 41 24 46 17 48 L15 42 C19 41 21 39 22 35 H16 Z" fill="currentColor" />
            <path d="M37 20 H50 V33 C50 41 45 46 38 48 L36 42 C40 41 42 39 43 35 H37 Z" fill="currentColor" />
        {:else if icon === 'board'}
            <path d="M20 13 H44 V25 A12 12 0 0 1 20 25 Z" fill="currentColor" />
            <path d="M32 37 V47" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" />
            <path d="M22 52 H42" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" />
        {:else if icon === 'coin'}
            <circle cx="32" cy="32" r="18" fill="currentColor" />
            <circle cx="32" cy="32" r="12" fill="none" stroke={background} stroke-width="2.5" opacity="0.8" />
            <path d="M32 24 V40 M27 28 H37 M27 36 H37" stroke={background} stroke-width="3" stroke-linecap="round" />
        {/if}
    </svg>
</span>

<style>
    /* The slight shade along the bottom is what a key on a keyboard has. */
    .tile {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        vertical-align: middle;
        box-shadow: inset 0 -0.09em 0 rgba(0, 0, 0, 0.16);
    }
    svg {
        display: block;
    }
</style>

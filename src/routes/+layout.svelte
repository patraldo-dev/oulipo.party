<script>
    import '../app.css';
    import { setLocale, t } from '#lib/i18n/index.js';
    /** @type {{ data: import('./$types').LayoutData, children?: import('svelte').Snippet }} */
    let { data, children } = $props();

    // Set as the page starts, not in an effect: an effect runs only in the
    // browser, and the server would write every page in the store's default
    // language before the browser could correct it. The first value is
    // the one that is wanted here; the effect that follows tracks the rest.
    // svelte-ignore state_referenced_locally
    setLocale(data.locale);
    $effect(() => {
        setLocale(data.locale);
        document.documentElement.lang = data.locale;
    });

    const LANGUAGES = [
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Español' },
        { code: 'fr', name: 'Français' }
    ];

    /** Remember a language and load the page again, so the server writes it in that language.
     * @param {string} code */
    function switchLanguage(code) {
        document.cookie = `preferredLanguage=${code}; path=/; max-age=31536000; samesite=lax`;
        location.reload();
    }

    function toggleTheme() {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    }
</script>

<svelte:head>
    <meta name="description" content={$t('site.description')} />
    <meta property="og:site_name" content="oulipo.party" />
    <meta property="og:description" content={$t('site.description')} />
    <meta name="theme-color" content="#ffffff" />
</svelte:head>

<div class="stripe" aria-hidden="true"></div>

<header class="site-head">
    <div class="site-head-in">
        <a class="wordmark" href="/">oulipo<span>.party</span></a>
        <nav aria-label={$t('nav.language')}>
            {#each LANGUAGES as language (language.code)}
                <button
                    class="chip"
                    class:current={data.locale === language.code}
                    onclick={() => switchLanguage(language.code)}
                    aria-current={data.locale === language.code ? 'true' : undefined}
                >
                    {language.name}
                </button>
            {/each}
            <button class="chip" onclick={toggleTheme} title={$t('nav.theme')} aria-label={$t('nav.theme')}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <circle cx="12" cy="12" r="4.2" fill="currentColor" />
                    <path
                        d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7"
                        stroke="currentColor"
                        stroke-width="1.9"
                        stroke-linecap="round"
                    />
                </svg>
            </button>
            {#if data.member}
                <a class="chip pill" href="/account">{$t('nav.account')}</a>
            {:else}
                <a class="chip pill" href="/sign-in">{$t('nav.signin')}</a>
            {/if}
        </nav>
    </div>
</header>

<main class="site-main">
    {@render children?.()}
</main>

<footer class="site-foot">
    <p class="foot-mark">oulipo<span>.party</span></p>
    <p class="foot-inspired">{$t('footer.inspired')}</p>
    <a class="foot-origin" href="https://patrouch.ca">
        {$t('footer.origin')}<span class="arrow" aria-hidden="true">↗</span>
    </a>
</footer>

<style>
    .site-head {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
    }
    .site-head-in {
        max-width: 760px;
        margin: 0 auto;
        padding: 0.7rem 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem 1rem;
        flex-wrap: wrap;
    }
    .wordmark {
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 1.45rem;
        letter-spacing: -0.035em;
        color: var(--text);
        text-decoration: none;
        line-height: 1;
        padding: 0.4rem 0;
    }
    .wordmark span {
        color: var(--accent);
    }
    nav {
        display: flex;
        align-items: center;
        gap: 0.1rem;
        flex-wrap: wrap;
    }
    .chip {
        font-family: var(--font-body);
        font-size: 0.9rem;
        font-weight: 600;
        padding: 0.45rem 0.7rem;
        border-radius: 8px;
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        transition: color 0.15s, background 0.15s;
    }
    .chip:hover {
        color: var(--text);
        background: var(--surface-raised);
    }
    /* The language being read is underlined, thick and in the game's blue. */
    .chip.current {
        color: var(--text);
        text-decoration: underline;
        text-decoration-color: var(--accent);
        text-decoration-thickness: 3px;
        text-underline-offset: 7px;
        border-radius: 8px 8px 0 0;
    }
    .chip.pill {
        border: 1.5px solid var(--text);
        color: var(--text);
        border-radius: 999px;
        padding: 0.4rem 0.95rem;
        margin-left: 0.4rem;
    }
    .chip.pill:hover {
        background: var(--contrast-bg);
        color: var(--contrast-text);
    }
    .chip:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 2px;
    }
    /* The foot: the name, what the game owes, and where it was born. */
    .site-foot {
        max-width: 760px;
        margin: 1.5rem auto 0;
        padding: 2rem 1.25rem 3rem;
        border-top: 1px solid var(--border);
        display: grid;
        justify-items: center;
        gap: 0.45rem;
        text-align: center;
    }
    .foot-mark {
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 1.1rem;
        letter-spacing: -0.035em;
        line-height: 1;
        color: var(--text);
        margin: 0;
    }
    .foot-mark span {
        color: var(--accent);
    }
    .foot-inspired {
        font-family: var(--font-reading);
        font-style: italic;
        font-size: 1.08rem;
        color: var(--text-dim);
        margin: 0;
    }
    /* A credit, not a bare link: quiet until the pointer finds it. */
    .foot-origin {
        display: inline-flex;
        align-items: baseline;
        gap: 0.3rem;
        margin-top: 0.4rem;
        color: var(--text-muted);
        font-size: 0.88rem;
        font-weight: 600;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: color 0.15s, border-color 0.15s;
    }
    .foot-origin:hover {
        color: var(--text);
        border-bottom-color: var(--text);
    }
    .foot-origin:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 3px;
    }
    .arrow {
        display: inline-block;
        transition: transform 0.15s;
    }
    .foot-origin:hover .arrow {
        transform: translate(2px, -2px);
    }
    /* On a narrow screen: the wordmark above, then one row with the languages
       and the theme on the left and the account on the right. */
    @media (max-width: 520px) {
        .site-head-in {
            flex-direction: column;
            align-items: center;
            gap: 0.2rem;
            padding: 0.6rem 0.75rem 0.5rem;
        }
        .wordmark {
            font-size: 1.3rem;
            padding: 0.2rem 0;
        }
        nav {
            width: 100%;
            justify-content: space-between;
            gap: 0;
        }
        .chip {
            font-size: 0.85rem;
            padding: 0.4rem 0.45rem;
        }
        .chip.pill {
            margin-left: auto;
            padding: 0.35rem 0.8rem;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .chip,
        .foot-origin,
        .arrow {
            transition: none;
        }
    }
</style>

<script>
    import { setLocale, t } from '#lib/i18n/index.js';
    /** @type {{ data: import('./$types').LayoutData, children?: import('svelte').Snippet }} */
    let { data, children } = $props();

    // Set as the page starts, not in an effect: an effect runs only in the
    // browser, and the server would write every page in the store's default
    // language before the browser could correct it.
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
    <meta name="theme-color" content="#5a6e65" />
</svelte:head>

<header class="site-head">
    <a class="wordmark" href="/">oulipo.party</a>
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
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
        </button>
        {#if data.member}
            <a class="chip" href="/account">{$t('nav.account')}</a>
        {:else}
            <a class="chip" href="/sign-in">{$t('nav.signin')}</a>
        {/if}
    </nav>
</header>

<main class="site-main">
    {@render children?.()}
</main>

<footer class="site-foot">
    <a href="https://patrouch.ca">{$t('footer.origin')}</a>
</footer>

<style>
    .site-head {
        max-width: 760px;
        margin: 0 auto;
        padding: 1.1rem 1.25rem 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
    }
    .wordmark {
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 1.25rem;
        letter-spacing: -0.01em;
        color: var(--text);
        text-decoration: none;
    }
    nav {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        flex-wrap: wrap;
    }
    .chip {
        font: inherit;
        font-size: 0.85rem;
        padding: 0.35rem 0.7rem;
        border-radius: 999px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        transition: color 0.2s, border-color 0.2s;
    }
    .chip:hover,
    .chip.current {
        color: var(--accent);
        border-color: var(--accent-border);
    }
    .chip:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .site-foot {
        max-width: 760px;
        margin: 0 auto;
        padding: 1rem 1.25rem 2.5rem;
        font-size: 0.8rem;
        color: var(--text-muted);
    }
    @media (prefers-reduced-motion: reduce) {
        .chip {
            transition: none;
        }
    }
</style>

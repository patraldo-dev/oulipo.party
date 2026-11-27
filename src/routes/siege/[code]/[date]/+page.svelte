<!-- src/routes/siege/[code]/[date]/+page.svelte
     An earlier day of a room: how that siege went, read only. Her rewrite
     may still be asked for, when the day ended before it was finished. -->
<script>
    import { onMount } from 'svelte';
    import { fill, t } from '#lib/i18n/index.js';
    import GameIcon from '#lib/components/GameIcon.svelte';
    import SiegeResult from '#lib/components/SiegeResult.svelte';
    import { post } from '#lib/api.js';

    /** @typedef {import('#lib/oulipo/types.js').SiegeView} SiegeView */

    let { data } = $props();

    // The page is rendered per visit, so reading the loader's answer once,
    // to start from, is exactly the intent.
    // svelte-ignore state_referenced_locally
    const start = {
        locale: data.locale,
        code: data.code,
        date: data.date,
        view: /** @type {SiegeView | null} */ (data.view)
    };

    let view = $state(start.view);
    let working = $state(false);
    /** Passes Sappho has made so far, while the rewrite is still going. */
    let pass = $state(start.view?.result?.rewrite.attempts ?? 0);
    let timer = $state(/** @type {number | undefined} */ (undefined));

    const HERE = `/siege/${start.code}`;
    const settled = $derived(view?.result?.rewrite.status === 'clean' || view?.result?.rewrite.status === 'escaped');
    const dayName = new Date(`${start.date}T12:00:00`).toLocaleDateString(start.locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });

    /** Ask for the rewrite until it settles, as the room does. @param {number} tries */
    async function rewrite(tries = 0) {
        working = true;
        const { ok, payload } = await post('/api/siege/rewrite', { code: start.code, date: start.date });
        working = false;
        if (ok && payload?.result) {
            view = payload;
            pass = /** @type {NonNullable<SiegeView['result']>} */ (payload.result).rewrite.attempts;
            if (settled) return;
            if (tries < 30) timer = window.setTimeout(() => rewrite(tries + 1), 1500);
        } else {
            pass = 0;
        }
    }

    onMount(() => {
        // A rewrite that was still under way when the day ended.
        if (view?.result && !settled) rewrite();
        return () => window.clearTimeout(timer);
    });
</script>

<svelte:head>
    <title>{$t('hub.siege_title')} — oulipo.party</title>
</svelte:head>

<div class="game-page">
    <header class="head">
        <GameIcon icon="siege" size={96} />
        <div>
            <h1>{$t('hub.siege_title')}</h1>
            <p class="tagline">{fill($t('siege.code'), { code: start.code })} · {dayName}</p>
        </div>
    </header>

    {#if view?.result}
        <SiegeResult result={view.result} {pass} {working} onask={() => rewrite()} />
        <p class="caption"><a href={HERE}>{$t('siege.today')} →</a></p>
    {:else}
        <section class="glass-surface card center">
            <p class="lead">{$t('siege.no_day')}</p>
            <div class="row">
                <a class="btn-secondary" href={HERE}>{$t('siege.today')}</a>
            </div>
        </section>
    {/if}
</div>

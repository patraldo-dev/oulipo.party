<script>
    import { page } from '$app/state';
    import { t } from '#lib/i18n/index.js';
</script>

<svelte:head>
    <title>{$t('error.title')} — oulipo.party</title>
</svelte:head>

<div class="error-page glass-surface">
    <h1>{page.status === 404 ? $t('error.notfound') : $t('error.title')}</h1>
    <a class="btn-primary" href="/">{$t('error.home')}</a>
</div>

<style>
    .error-page {
        max-width: 32rem;
        margin: 4rem auto;
        padding: 2.5rem;
        text-align: center;
        display: grid;
        gap: 1.5rem;
        justify-items: center;
    }
</style>

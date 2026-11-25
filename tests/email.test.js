// Mail: node --test tests/email.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EmailError,
    emailConfigured,
    languageOf,
    resetMail,
    sendEmail,
    verificationMail
} from '../src/lib/server/email-sender.js';

const MESSAGE = Object.freeze({
    to: 'member@example.com',
    subject: 'Welcome',
    html: '<p>Welcome</p>',
    text: 'Welcome'
});
const SITE = { name: 'oulipo.party', email: 'noreply@oulipo.party' };
const withBinding = (send) => ({ EMAIL_FROM: 'oulipo.party <noreply@oulipo.party>', EMAIL: { send } });

test('a message goes out through the Worker binding, addressed as given', async () => {
    const sent = [];
    const env = withBinding(async (message) => void sent.push(message));
    assert.equal(emailConfigured(env), true);
    await sendEmail(env, MESSAGE);
    assert.deepEqual(sent, [{ ...MESSAGE, from: SITE }]);
});

test('the sender reaches the binding in the two forms it accepts', async () => {
    const seen = [];
    const send = async ({ from }) => void seen.push(from);
    const run = (EMAIL_FROM) => sendEmail({ EMAIL_FROM, EMAIL: { send } }, MESSAGE);
    await run('noreply@oulipo.party');
    await run('oulipo.party (staging)  <staging@oulipo.party> ');
    await run('"oulipo.party, inc." <noreply@oulipo.party>');
    await run('<noreply@oulipo.party>');
    assert.deepEqual(seen, [
        'noreply@oulipo.party',
        { name: 'oulipo.party (staging)', email: 'staging@oulipo.party' },
        { name: 'oulipo.party, inc.', email: 'noreply@oulipo.party' },
        { name: 'noreply@oulipo.party', email: 'noreply@oulipo.party' }
    ]);
});

test('a Worker without the binding, or without a sender, cannot send, and says why', async () => {
    assert.equal(emailConfigured({}), false);
    assert.equal(emailConfigured({ EMAIL_BACKEND: 'cloudflare' }), false);
    await assert.rejects(sendEmail({}, MESSAGE), { code: 'no_binding' });
    await assert.rejects(sendEmail({ EMAIL: { send: async () => {} } }, MESSAGE), { code: 'no_sender' });
});

test('a refusal from the service is passed on with its code', async () => {
    await assert.rejects(
        sendEmail(
            withBinding(async () => {
                throw Object.assign(new Error('destination address is not a verified address'), {
                    code: 'E_RECIPIENT_NOT_ALLOWED'
                });
            }),
            MESSAGE
        ),
        { code: 'E_RECIPIENT_NOT_ALLOWED' }
    );
});

test('the verification mail is written in each of the three languages and carries the link in both parts', async () => {
    const link = 'https://oulipo.party/api/auth/verify-email?token=abc&callbackURL=%2F';
    const subjects = new Set();
    for (const lang of ['en', 'es', 'fr']) {
        const mail = verificationMail(lang, link);
        subjects.add(mail.subject);
        assert.ok(mail.subject.includes('oulipo.party'));
        assert.ok(mail.html.includes(link), `${lang}: the link is a button`);
        assert.ok(mail.text.includes(link), `${lang}: and a line of text`);
        assert.ok(!mail.html.includes('{'), `${lang}: nothing left unfilled`);
    }
    assert.equal(subjects.size, 3, 'three different subjects');
    assert.ok(verificationMail('es', link).html.includes('Verificar correo'), 'the button in Spanish');
    assert.ok(verificationMail('fr', link).html.includes('Vérifier l’adresse'));
});

test('the reset mail too', async () => {
    const link = 'https://oulipo.party/reset-password?token=abc';
    for (const lang of ['en', 'es', 'fr']) {
        const mail = resetMail(lang, link);
        assert.ok(mail.html.includes(link) && mail.text.includes(link), lang);
        assert.ok(!mail.html.includes('{'), lang);
    }
    assert.equal(resetMail('es', link).subject, 'Restablece tu contraseña — oulipo.party');
});

test('each letter is one page: a title, a sentence, one button', () => {
    const link = 'https://oulipo.party/reset-password?token=abc';
    for (const mail of [resetMail('en', link), verificationMail('es', 'https://oulipo.party/api/auth/verify-email?token=abc')]) {
        assert.equal((mail.html.match(/<a /g) ?? []).length, 1, 'one link: the button');
        assert.ok(mail.html.includes('<h2'), 'a title');
    }
});

test("the member's language follows what their browser prefers", () => {
    const asking = (value) => languageOf(new Request('https://oulipo.party/', { headers: { 'accept-language': value } }));
    assert.equal(asking('fr-CA,fr;q=0.9,en;q=0.8'), 'fr');
    assert.equal(asking('es-MX,es;q=0.9'), 'es');
    assert.equal(asking('en-US,en;q=0.9,fr;q=0.5'), 'en', 'a language named below English does not win');
    assert.equal(asking('de-DE,de;q=0.9,es;q=0.8'), 'es', 'the best of the three the site speaks');
    assert.equal(asking('*'), 'en');
    assert.equal(asking(''), 'en');
    assert.equal(languageOf(null), 'en');
    assert.equal(languageOf(undefined), 'en');
});

// src/lib/server/email-sender.js
// Transactional mail through Cloudflare's Email Sending. The Worker's EMAIL
// binding is the credential: there is no key to keep. The binding takes a
// sender as a bare address, or as an address with a name; the "Name <address>"
// string other services accept is rejected by it.

/** The site's bindings, as `wrangler types` describes them.
 * @typedef {Cloudflare.Env} Env */

export class EmailError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message);
        this.name = 'EmailError';
        this.code = code;
    }
}

/** Whether this Worker can send at all. @param {Env} env */
export function emailConfigured(env) {
    return Boolean(env?.EMAIL && env?.EMAIL_FROM);
}

/**
 * The sender as the binding takes it.
 * @param {string} value
 * @returns {string | { email: string, name: string }}
 */
function sender(value) {
    const match = /^(.*)<([^<>]+)>\s*$/.exec(String(value));
    if (!match) return String(value).trim();
    const email = match[2].trim();
    const name = match[1].trim().replace(/^"(.*)"$/, '$1');
    return { email, name: name || email };
}

/**
 * Send one message. Throws an EmailError when this Worker cannot send at all;
 * a refusal from the service is passed on as it came, with its own code.
 * @param {Env} env
 * @param {{ to: string, subject: string, html: string, text: string }} message
 */
export async function sendEmail(env, { to, subject, html, text }) {
    if (!env?.EMAIL) {
        throw new EmailError('no_binding', 'This Worker has no EMAIL binding');
    }
    if (!env.EMAIL_FROM) {
        throw new EmailError('no_sender', 'EMAIL_FROM is not set');
    }
    await env.EMAIL.send({ to, from: sender(env.EMAIL_FROM), subject, html, text });
}

/** @typedef {'en' | 'es' | 'fr'} Lang */

/**
 * The member's language: the one their browser prefers most among the three
 * the site speaks, by the weights the browser gives them (q); English when it
 * names none of them.
 * @param {Request | null | undefined} request
 * @returns {Lang}
 */
export function languageOf(request) {
    const accepted = request?.headers?.get('accept-language') ?? '';
    /** @type {Lang | null} */
    let chosen = null;
    let top = 0;
    for (const part of accepted.split(',')) {
        const [tag, ...parameters] = part.trim().toLowerCase().split(';');
        const weight = parameters.find((parameter) => parameter.trim().startsWith('q='));
        const q = weight ? Number.parseFloat(weight.trim().slice(2)) : 1;
        /** @type {unknown} */
        const code = tag.split('-')[0];
        if ((code === 'en' || code === 'es' || code === 'fr') && q > top) {
            top = q;
            chosen = code;
        }
    }
    return chosen ?? 'en';
}

/** @typedef {{ subject: string, title: string, body: string, button: string, footnote: string }} Wording */

const VERIFY = {
    en: {
        subject: 'Verify your email — oulipo.party',
        title: 'Welcome to oulipo.party',
        body: 'Click below to verify your email address. Then you can play today’s duel.',
        button: 'Verify email',
        footnote: 'If you didn’t create an account, you can ignore this email.'
    },
    es: {
        subject: 'Verifica tu correo — oulipo.party',
        title: 'Te damos la bienvenida a oulipo.party',
        body: 'Haz clic abajo para verificar tu correo. Después podrás jugar el duelo de hoy.',
        button: 'Verificar correo',
        footnote: 'Si no creaste una cuenta, puedes ignorar este correo.'
    },
    fr: {
        subject: 'Vérifiez votre adresse — oulipo.party',
        title: 'Bienvenue sur oulipo.party',
        body: 'Cliquez ci-dessous pour vérifier votre adresse. Vous pourrez ensuite jouer le duel du jour.',
        button: 'Vérifier l’adresse',
        footnote: 'Si vous n’avez pas créé de compte, vous pouvez ignorer ce message.'
    }
};

const RESET = {
    en: {
        subject: 'Reset your password — oulipo.party',
        title: 'Reset your password',
        body: 'You asked to reset your password. Click below to choose a new one.',
        button: 'Choose a new password',
        footnote: 'This link expires in an hour. If you didn’t ask for this, ignore the email.'
    },
    es: {
        subject: 'Restablece tu contraseña — oulipo.party',
        title: 'Restablece tu contraseña',
        body: 'Solicitaste restablecer tu contraseña. Haz clic abajo para elegir una nueva.',
        button: 'Elegir una nueva contraseña',
        footnote: 'Este enlace vence en una hora. Si no lo solicitaste, ignora el correo.'
    },
    fr: {
        subject: 'Réinitialisez votre mot de passe — oulipo.party',
        title: 'Réinitialisez votre mot de passe',
        body: 'Vous avez demandé à réinitialiser votre mot de passe. Cliquez ci-dessous pour en choisir un nouveau.',
        button: 'Choisir un nouveau mot de passe',
        footnote: 'Ce lien expire dans une heure. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.'
    }
};

/** One mail in the member's language: a card, a sentence, one button. @param {Wording} wording @param {string} link */
function letter({ subject, title, body, button, footnote }, link) {
    const html = `
        <div style="max-width:480px;margin:0 auto;padding:2rem;font-family:Georgia,serif;color:#1d2b24;background:#f0f5f1;border-radius:12px;">
            <h1 style="margin:0 0 2rem;text-align:center;font-size:1.4rem;font-weight:600;color:#5a6e65;">oulipo.party</h1>
            <h2 style="font-size:1.15rem;">${title}</h2>
            <p style="color:#45544c;">${body}</p>
            <div style="margin:2rem 0;text-align:center;">
                <a href="${link}" style="display:inline-block;padding:12px 28px;background:#5a6e65;color:#f0f5f1;text-decoration:none;border-radius:8px;font-weight:600;font-family:system-ui,sans-serif;">${button}</a>
            </div>
            <p style="color:#63756b;font-size:0.8rem;text-align:center;">${footnote}</p>
        </div>
    `;
    return { subject, html, text: `${title}\n\n${body}\n\n${link}\n\n${footnote}` };
}

/** The mail that verifies a new member's address. @param {Lang} lang @param {string} link */
export const verificationMail = (lang, link) => letter(VERIFY[lang], link);

/** The mail that lets a member reset their password. @param {Lang} lang @param {string} link */
export const resetMail = (lang, link) => letter(RESET[lang], link);

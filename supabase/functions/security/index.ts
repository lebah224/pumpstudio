// Sécurité du compte : code de confirmation des actions sensibles (par e-mail ou par la double authentification),
// appareils connus et alerte de nouvelle connexion, sessions ouvertes, code anti-hameçonnage.
import { Fail, STEP_UP_PURPOSES, admin, alertMail, audit, claims, clientIp, cors, json, maskEmail, rate, requireUser, sendMail, type StepUpPurpose } from '../_shared/security.ts';

const enc = new TextEncoder();
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const code6 = () => String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
const PURPOSE_LABEL: Record<StepUpPurpose, { fr: string; en: string }> = {
  withdraw: { fr: 'un retrait depuis ton wallet rapide', en: 'a withdrawal from your quick wallet' },
  limits_up: { fr: 'la hausse du plafond de ton wallet rapide', en: 'raising your quick wallet cap' },
  export_key: { fr: 'l\'export de la clé de ton wallet rapide', en: 'exporting your quick wallet key' },
  delete_wallet: { fr: 'la suppression de ton wallet rapide', en: 'deleting your quick wallet' },
  link_wallet: { fr: 'l\'ajout d\'un wallet à ton compte', en: 'adding a wallet to your account' },
  delete_account: { fr: 'la suppression de ton compte', en: 'deleting your account' },
};
const isPurpose = (p: unknown): p is StepUpPurpose => typeof p === 'string' && (STEP_UP_PURPOSES as readonly string[]).includes(p);

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);
  try {
    const user = await requireUser(req);
    const uid = user.id, cl = claims(req);
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* corps vide */ }
    const hasTotp = (user.factors ?? []).some((f) => f.factor_type === 'totp' && f.status === 'verified');

    switch (body.action) {
      /* --- moyens de confirmation disponibles --- */
      case 'stepup_methods':
        return json(200, { email: user.email ? maskEmail(user.email) : null, totp: hasTotp }, h);

      /* --- envoi du code par e-mail (10 minutes, 5 essais) --- */
      case 'stepup_send': {
        if (!isPurpose(body.purpose)) throw new Fail(400, 'Action inconnue.');
        if (!user.email) throw new Fail(409, 'Ajoute une adresse e-mail à ton compte (Mon compte → Profil) ou active la double authentification pour confirmer cette action.', { code: 'no_method' });
        await rate('stepup_send:' + uid, 5, 3600, 'Trop de codes demandés : réessaie dans une heure.');
        await rate('stepup_send30:' + uid, 1, 30, 'Un code vient d\'être envoyé : attends 30 secondes avant d\'en demander un autre.');
        const code = code6(), purpose = body.purpose;
        await admin.rpc('sec_stepup_set', { uid, p_purpose: purpose, p_hash: await sha(uid + ':' + purpose + ':' + code), p_ttl: 600 });
        const ok = await sendMail(user, { fr: 'Code TokenStudio : ' + code, en: 'TokenStudio code: ' + code }, (lang) => ({
          title: lang === 'en' ? 'Confirm this action' : 'Confirme cette action',
          lead: (lang === 'en' ? 'Enter this code in TokenStudio to confirm ' : 'Saisis ce code dans TokenStudio pour confirmer ') + PURPOSE_LABEL[purpose][lang] + '.',
          code,
          foot: lang === 'en' ? 'The code expires in 10 minutes. Never share it: TokenStudio will never ask for it by phone or message. If you didn\'t request it, someone may be using your account: disconnect all your devices.' : 'Le code expire dans 10 minutes. Ne le transmets à personne : TokenStudio ne te le demandera jamais par téléphone ou par message. Si tu n\'as rien demandé, quelqu\'un utilise peut-être ton compte : déconnecte tous tes appareils.',
        }));
        if (!ok) throw new Fail(503, 'Envoi de l\'e-mail impossible pour le moment. Réessaie, ou utilise la double authentification.');
        return json(200, { sent: true, to: maskEmail(user.email) }, h);
      }

      /* --- vérification : code reçu par e-mail, ou double authentification validée à l'instant --- */
      case 'stepup_verify': {
        if (!isPurpose(body.purpose)) throw new Fail(400, 'Action inconnue.');
        await rate('stepup_verify:' + uid, 15, 600);
        const purpose = body.purpose;
        if (body.method === 'totp') {
          // le navigateur vient de valider un code de l'application (session aal2, méthode totp horodatée dans le jeton)
          const amr = Array.isArray(cl.amr) ? cl.amr as { method?: string; timestamp?: number }[] : [];
          const fresh = cl.aal === 'aal2' && amr.some((a) => a.method === 'totp' && typeof a.timestamp === 'number' && Date.now() / 1000 - a.timestamp < 300);
          if (!hasTotp || !fresh) throw new Fail(403, 'Code de double authentification non validé : recommence.');
          await admin.rpc('sec_grant_add', { uid, p_purpose: purpose });
          return json(200, { ok: true }, h);
        }
        const c = String(body.code ?? '').replace(/\D/g, '');
        if (c.length !== 6) throw new Fail(400, 'Le code fait 6 chiffres.');
        const { data: r } = await admin.rpc('sec_stepup_check', { uid, p_purpose: purpose, p_hash: await sha(uid + ':' + purpose + ':' + c) });
        if (r === 'ok') return json(200, { ok: true }, h);
        throw new Fail(r === 'bad' ? 403 : 410, r === 'bad' ? 'Code incorrect.' : r === 'locked' ? 'Trop d\'essais : demande un nouveau code.' : 'Code expiré : demande un nouveau code.');
      }

      /* --- appareil : alerte à la première connexion depuis un nouvel appareil --- */
      case 'device': {
        const id = String(body.device_id ?? '');
        if (!/^[0-9a-f-]{36}$/.test(id)) throw new Fail(400, 'Appareil invalide.');
        await rate('device:' + uid, 30, 3600);
        const label = String(body.label ?? '').replace(/[^\p{L}\d ·.()/_-]/gu, '').slice(0, 60) || 'Appareil';
        const { data: st } = await admin.rpc('sec_device_seen', { uid, p_hash: await sha(uid + ':' + id), p_label: label });
        if (st === 'new') {
          const ip = clientIp(req);
          await audit(uid, 'login_new_device', { device: label, ip });
          alertMail(user, 'login_new_device', { device: label, ip: ip || '—' }).catch(() => {});
        }
        return json(200, { status: st }, h);
      }

      /* --- sessions ouvertes --- */
      case 'sessions': {
        await rate('sessions:' + uid, 60, 3600);
        const { data, error } = await admin.rpc('sec_sessions', { uid });
        if (error) throw new Fail(500, 'Lecture des sessions impossible.');
        return json(200, { current: cl.session_id ?? null, sessions: data ?? [] }, h);
      }
      case 'revoke': {
        await rate('revoke:' + uid, 30, 3600);
        const sid = String(body.session_id ?? '');
        if (!/^[0-9a-f-]{36}$/.test(sid)) throw new Fail(400, 'Session invalide.');
        if (sid === cl.session_id) throw new Fail(400, 'C\'est cet appareil : utilise « Se déconnecter ».');
        const { data: ok } = await admin.rpc('sec_session_revoke', { uid, sid });
        if (ok) await audit(uid, 'session_revoked', { session: sid.slice(0, 8) });
        return json(200, { ok: !!ok }, h);
      }
      case 'revoke_others': {
        await rate('revoke:' + uid, 30, 3600);
        const { data } = await admin.rpc('sec_sessions', { uid });
        let n = 0;
        for (const s of (data ?? []) as { id: string }[]) { if (s.id !== cl.session_id) { const { data: ok } = await admin.rpc('sec_session_revoke', { uid, sid: s.id }); if (ok) n++; } }
        if (n) await audit(uid, 'sessions_revoked', { count: n });
        return json(200, { revoked: n }, h);
      }

      /* --- code anti-hameçonnage, affiché en haut de chaque e-mail --- */
      case 'anti_phishing': {
        await rate('anti:' + uid, 10, 3600);
        const v = String(body.code ?? '').trim();
        if (v && !/^[\p{L}\d][\p{L}\d _-]{2,22}[\p{L}\d]$/u.test(v)) throw new Fail(400, 'Code : 4 à 24 lettres ou chiffres (espaces, - et _ permis au milieu).');
        const { error } = await admin.auth.admin.updateUserById(uid, { user_metadata: { ...(user.user_metadata ?? {}), anti_phishing: v || null } });
        if (error) throw new Fail(500, 'Enregistrement impossible.');
        await audit(uid, 'anti_phishing_set', { set: !!v });
        if (v) alertMail({ ...user, user_metadata: { ...(user.user_metadata ?? {}), anti_phishing: v } }, 'anti_phishing').catch(() => {});
        return json(200, { ok: true }, h);
      }

      /* --- e-mail d'essai (vérifier la configuration d'envoi) --- */
      case 'mail_test': {
        await rate('mail_test:' + uid, 3, 3600);
        const ok = await sendMail(user, { fr: 'TokenStudio : e-mail d\'essai', en: 'TokenStudio: test email' }, (lang) => ({
          title: lang === 'en' ? 'Security emails work' : 'Les e-mails de sécurité fonctionnent',
          lead: lang === 'en' ? 'You will receive your confirmation codes and security alerts at this address.' : 'Tu recevras tes codes de confirmation et tes alertes de sécurité à cette adresse.',
          foot: lang === 'en' ? 'Nothing to do.' : 'Rien à faire.',
        }));
        if (!ok) throw new Fail(503, 'Envoi impossible : la configuration des e-mails du serveur est incomplète.');
        return json(200, { ok: true }, h);
      }
    }
    throw new Fail(400, 'Action inconnue.');
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.message, ...e.extra }, h);
    return json(500, { error: 'Erreur du serveur.' }, h);
  }
});

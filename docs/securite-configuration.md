# Sécurité : réglages à faire dans Cloudflare, Brevo et Supabase

Le code de la phase 5 est en place. Trois réglages se font dans des comptes qui t'appartiennent : ils ne passent pas par le code.

## 1. Case « Je ne suis pas un robot » (Cloudflare Turnstile, gratuit)

1. Crée un compte gratuit sur https://dash.cloudflare.com, puis ouvre **Turnstile** dans le menu de gauche → **Add widget**.
2. Remplis :
   - Widget name : `TokenStudio`
   - Hostnames : `tokenstudio-sol.vercel.app` et `tokenstudio-git-claude-brave-mendel-kxixmn-sadou-9f22dc7f.vercel.app` (et plus tard ton domaine)
   - Widget mode : **Managed**
3. Cloudflare affiche deux clés :
   - la **Site Key** (publique) : envoie-la moi, je la mets dans Vercel et je redéploie ;
   - la **Secret Key** (secrète) : ne l'envoie à personne, tu la colles toi-même à l'étape 4.
4. **Seulement quand je t'ai confirmé que la case s'affiche sur la page de connexion :**
   - Supabase → *Authentication* → *Attack Protection* (https://supabase.com/dashboard/project/juuytckoiheivddkkrgk/auth/protection) → active **Enable Captcha protection**, choisis **Turnstile by Cloudflare**, colle la Secret Key, enregistre ;
   - Supabase → *Edge Functions* → *Secrets* (https://supabase.com/dashboard/project/juuytckoiheivddkkrgk/functions/secrets) → ajoute `TURNSTILE_SECRET` = la même Secret Key.

> Si tu actives la protection dans Supabase avant que la case soit en ligne, plus personne ne pourra se connecter : respecte l'ordre.

## 2. E-mails de sécurité (codes de confirmation et alertes) : clé API Brevo

L'envoi des e-mails de connexion passe déjà par Brevo (SMTP). Les codes de confirmation et les alertes sont envoyés par le serveur, avec l'API de Brevo :

1. Brevo → **SMTP et API** → onglet **Clés API et MCP** → **Générer une nouvelle clé API**, nomme-la `Supabase`, copie-la.
2. Brevo → **Sécurité** → **IPs autorisées** → **Désactiver pour les clés API** (comme tu l'as fait pour SMTP).
3. Supabase → *Edge Functions* → *Secrets* → ajoute :
   - `BREVO_API_KEY` = la clé API Brevo ;
   - `BREVO_SENDER` = l'adresse d'expéditeur validée dans Brevo.
4. Dans TokenStudio : menu du compte → **Sécurité** → **Envoyer un e-mail d'essai**.

Dès que ces deux secrets existent, le code de confirmation devient obligatoire pour : retrait, export de clé, hausse du plafond et suppression du wallet rapide, ajout d'un wallet (si tu as un wallet rapide), suppression du compte. Avant, ces actions restent possibles sans code, pour ne bloquer personne.

## 3. Modèles d'e-mails de connexion (code anti-hameçonnage)

Les 4 modèles de `supabase/templates/` affichent maintenant le code anti-hameçonnage de l'utilisateur. Recolle-les dans Supabase → *Authentication* → *Emails* → *Templates* (mêmes sujets qu'avant).

## Ce qui est déjà actif, sans réglage

- Mots de passe du wallet rapide : 10 caractères, majuscule, minuscule, chiffre et symbole, vérifiés par le navigateur et par le serveur.
- Délai de 24 heures avant qu'un nouveau wallet lié puisse recevoir des retraits du wallet rapide.
- Appareils connectés : liste des sessions et déconnexion appareil par appareil.
- Code anti-hameçonnage : à choisir dans l'onglet Sécurité.
- Limites d'appels sur toutes les fonctions serveur ; test d'isolation des comptes dans `supabase/tests/rls_isolation.sql`.

# Connexion avec Google : activation (10 minutes, gratuit)

Le bouton « Continuer avec Google » est déjà dans le site. Il reste caché tant que Google n'est pas activé dans Supabase : il apparaîtra tout seul dès que les deux étapes ci-dessous sont faites.

## 1. Google Cloud : créer l'identifiant de connexion

1. Ouvrez https://console.cloud.google.com/ avec votre compte Google, puis créez un projet nommé `TokenStudio` (menu en haut à gauche → *Nouveau projet*).
2. Menu → **Google Auth Platform** (ou *API et services → Écran de consentement OAuth*) → **Commencer** :
   - Nom de l'application : `TokenStudio`
   - Adresse e-mail d'assistance : votre adresse
   - Audience : **Externe**
   - Coordonnées : votre adresse
3. Onglet **Branding** (Image de marque) :
   - Page d'accueil : `https://tokenstudio-sol.vercel.app`
   - Règles de confidentialité : `https://tokenstudio-sol.vercel.app/confidentialite`
   - Conditions d'utilisation : `https://tokenstudio-sol.vercel.app/conditions`
   - Domaines autorisés : `supabase.co` et `tokenstudio-sol.vercel.app`
4. Onglet **Audience** → **Publier l'application** (passer « En production »). Seuls le nom, l'e-mail et la photo sont demandés : Google n'exige pas de vérification.
5. Onglet **Clients** → **Créer un client** :
   - Type : **Application Web**, nom `TokenStudio`
   - Origines JavaScript autorisées : `https://tokenstudio-sol.vercel.app`
   - URI de redirection autorisés : `https://juuytckoiheivddkkrgk.supabase.co/auth/v1/callback`
   - **Créer** : Google affiche un **ID client** et un **Code secret du client**. Gardez la fenêtre ouverte.

## 2. Supabase : activer Google

1. https://supabase.com/dashboard/project/juuytckoiheivddkkrgk/auth/providers → **Google** → activez **Enable Sign in with Google**.
2. Collez l'**ID client** dans *Client IDs* et le **Code secret** dans *Client Secret (for OAuth)*, puis **Save**.
3. Vérifiez dans *Authentication → URL Configuration* que *Redirect URLs* contient `https://tokenstudio-sol.vercel.app/**` (déjà en place pour les e-mails).

## 3. Vérifier

Rechargez https://tokenstudio-sol.vercel.app/connexion : le bouton **Continuer avec Google** apparaît en premier. Connectez-vous : à la première connexion, le compte est créé et la fenêtre de bienvenue propose votre nom Google.

> La fenêtre de Google affiche l'adresse technique `juuytckoiheivddkkrgk.supabase.co`. Pour afficher votre propre nom de domaine à la place, il faut un domaine personnalisé (option payante de Supabase).

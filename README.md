# TokenStudio

Plateforme de création, de lancement et de suivi de tokens Solana (pump.fun). **Non-custodial** : aucune clé privée ne quitte jamais le wallet de l'utilisateur.

Production actuelle : https://tokenstudio-sol.vercel.app

## Architecture

| Couche | Technologie | Dossier |
|---|---|---|
| Interface | Vite + React + TypeScript | `src/` |
| Studio historique (migration page par page vers React) | JavaScript | `src/legacy/` |
| Kit Solana / pump.fun empaqueté | JavaScript | `public/vendor/pumpkit.js` |
| Base de données, connexion, stockage | Supabase (Postgres, Auth, Storage) | `supabase/migrations/` |
| Fonctions serveur | Supabase Edge Functions (Deno) | `supabase/functions/` |
| Hébergement et en-têtes de sécurité | Vercel | `vercel.json` |

Les écrans React (connexion, Mon compte) s'insèrent dans le studio historique par des portails React. Les pages existantes seront migrées une par une.

## Démarrer en local

```bash
npm ci
cp .env.example .env.local   # adresse et clé publique Supabase
npm run dev                  # http://localhost:5173
npm run build                # vérification des types + build de production dans dist/
```

## Sécurité

- **Non-custodial** : le serveur ne reçoit jamais de clé privée. Les wallets liés sont des adresses publiques, ajoutées seulement après vérification d'une signature ed25519 (`supabase/functions/link-wallet`).
- **RLS** sur toutes les tables : chaque utilisateur ne lit et ne modifie que ses propres lignes. Aucun accès anonyme.
- **Droits par colonne** : un utilisateur ne peut ni changer l'identifiant de ses lignes, ni ajouter un wallet sans preuve, ni écrire dans le journal d'audit.
- **Journal d'audit** écrit par la base : création du compte, wallets ajoutés ou retirés, passage en mode réel, changement de limite d'achat.
- **Limites anti-abus** par compte (brouillons, tokens, ordres, wallets).
- **Double authentification** (TOTP) disponible pour tous les comptes.
- **CSP stricte** (`script-src 'self'`, aucun script en ligne), HSTS, protection contre l'intégration en iframe, Permissions-Policy (`vercel.json`).
- La clé Supabase présente dans le code est la clé **publique** (`publishable`). La clé secrète n'est utilisée que dans les fonctions serveur.

## Configuration Supabase (tableau de bord)

Projet : `tokenstudio` (Francfort, `eu-central-1`).

1. **Authentication → Sign In / Providers → Web3 Wallet** : activer Solana.
2. **Authentication → URL Configuration** : *Site URL* `https://tokenstudio-sol.vercel.app`, et *Redirect URLs* `https://tokenstudio-sol.vercel.app/**`, `https://*-sadou-9f22dc7f.vercel.app/**`, `http://localhost:5173/**`.
3. **Authentication → Emails → Magic Link** : ajouter `{{ .Token }}` au modèle pour que l'e-mail contienne aussi le code.
4. **Authentication → Multi-Factor** : TOTP activé (par défaut).

# E-mails du compte : Brevo + Supabase

Les e-mails de connexion (code et lien) sont envoyés par Supabase. Son envoi intégré est limité à quelques messages par heure : on le remplace par **Brevo** (gratuit, 300 e-mails par jour).

Les modèles d'e-mails sont dans `supabase/templates/`. Ils sont **bilingues** : la langue choisie sur le site au moment de l'inscription est enregistrée dans le compte (`lang` dans les métadonnées). Les comptes plus anciens reçoivent la version française.

## 1. Créer le compte Brevo (5 minutes)

1. Inscrivez-vous sur https://www.brevo.com (offre gratuite).
2. **Expéditeur** : menu *Expéditeurs, domaines et IP dédiées* → *Expéditeurs* → *Ajouter un expéditeur*.
   - Nom : `TokenStudio`
   - Adresse : une adresse à vous (par exemple votre Gmail). Brevo vous envoie un e-mail pour la vérifier.
3. **Clé SMTP** : menu *SMTP et API* → onglet *SMTP* → *Générer une nouvelle clé SMTP*. Notez :
   - le serveur : `smtp-relay.brevo.com`, port `587` ;
   - l'identifiant (il ressemble à `xxxxxx@smtp-brevo.com`) ;
   - la clé (elle ne s'affiche qu'une fois).

> Sans domaine à vous, certains messages peuvent arriver dans les indésirables. Le jour où vous avez un domaine, ajoutez-le dans Brevo (enregistrements DKIM et DMARC) et utilisez une adresse comme `contact@votredomaine`.

## 2. Brancher Brevo sur Supabase

Dans Supabase → projet **tokenstudio** → *Authentication* → *Emails* → onglet *SMTP Settings* → activez **Enable custom SMTP** :

| Champ | Valeur |
| --- | --- |
| Sender email | l'adresse vérifiée à l'étape 1 |
| Sender name | `TokenStudio` |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | l'identifiant SMTP Brevo |
| Password | la clé SMTP Brevo |

Puis *Authentication* → *Rate Limits* : passez **Rate limit for sending emails** à `100` par heure (la valeur par défaut est basse).

## 3. Coller les modèles

*Authentication* → *Emails* → onglet *Templates*. Pour chaque modèle, collez le sujet et le contenu du fichier :

| Modèle Supabase | Sujet | Fichier |
| --- | --- | --- |
| Confirm signup | `Code TokenStudio : {{ .Token }}` | `supabase/templates/confirmation.html` |
| Magic Link | `Code TokenStudio : {{ .Token }}` | `supabase/templates/magic_link.html` |
| Change Email Address | `TokenStudio : confirmez votre nouvelle adresse · confirm your new address` | `supabase/templates/email_change.html` |
| Reauthentication | `Code TokenStudio : {{ .Token }}` | `supabase/templates/reauthentication.html` |

Enregistrez chaque modèle.

## 4. Vérifier

Sur `/inscription`, choisissez *Continuer avec un e-mail* avec une adresse de test : l'e-mail doit arriver en moins d'une minute, avec le code à 6 chiffres. Recommencez avec le site en anglais (bouton **EN**) et une autre adresse : l'e-mail doit être en anglais.

En cas de problème : Supabase → *Logs* → *Auth* montre l'erreur d'envoi ; Brevo → *Transactionnel* → *Journaux* montre si le message est parti.

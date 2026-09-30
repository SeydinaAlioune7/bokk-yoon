# Bokk Yoon

Covoiturage et envoi de colis entre les villes du Sénégal. « Bokk yoon » veut dire « partager la route » en wolof.

## Modèle

Bokk Yoon est l'opérateur : **le propriétaire fixe les prix**, le client **paie à la réservation**, Bokk Yoon **encaisse**, garde sa marge et **reverse sa part au chauffeur** après la mission. Le chauffeur ne fixe aucun prix et ne voit jamais le prix payé par le client.

## Trois espaces séparés

| Espace | Adresse | Qui | Ce qu'on y fait |
| --- | --- | --- | --- |
| Site vitrine | `/` | Public | Présentation, axes et prix, carte nationale, actualités, liste d'attente, API boutiques |
| Client | `/app/` | Voyageurs, expéditeurs, boutiques | Recherche, réservation et paiement immédiat, colis et trajets compatibles, codes de remise, suivi en direct sur carte, messages, avis, réclamations, signalements, clés API boutique |
| Chauffeur | `/chauffeur/` | Chauffeurs partenaires | Dossier (pièce, permis, assurance, véhicule), validation par l'équipe, publication de trajets avec rémunération affichée, missions, codes, partage GPS, gains et versements |
| Équipe | `/admin/` | Propriétaire et équipe | Tableau de bord (CA, marge, dû aux chauffeurs), carte en direct, chauffeurs et candidatures, clients, avertir / suspendre / bloquer / réactiver, réservations, trajets, litiges et signalements, paiements chauffeurs, tarifs, actualités et alertes route, équipe, journal |

Un numéro de téléphone appartient à un seul espace : un compte client ne peut pas entrer dans l'espace chauffeur, et inversement. Le contrôle est fait par l'API (chaque route vérifie le rôle), pas seulement par l'interface.

**Droits de l'équipe**

| Action | Membre de l'équipe | Propriétaire |
| --- | --- | --- |
| Valider un chauffeur, traiter signalements et réclamations | Oui | Oui |
| Avertir, suspendre (jusqu'à 30 jours), réactiver | Oui | Oui |
| Bloquer définitivement, suspendre plus de 30 jours | Non | Oui |
| Rembourser plus de 50 000 FCFA | Non | Oui |
| Fixer les tarifs et règles, payer les chauffeurs, gérer l'équipe | Non | Oui |

Une suspension déconnecte le compte. Pour un chauffeur, ses trajets à venir sont retirés et ses clients remboursés. Pour un client, ses réservations à venir sont annulées et remboursées. Chaque action est tracée dans le journal.

## Deux modes, un seul code

Si l'API répond, l'application est en mode connecté (base Cloudflare D1, données partagées). Sinon, elle passe en **mode démo** : le même code serveur tourne dans le navigateur sur SQLite (WebAssembly) avec des données d'exemple (chauffeurs, trajets, 14 jours d'historique, actualités, alertes).

Comptes de démonstration (code SMS affiché à l'écran) :

- Propriétaire : 77 000 00 00 (espace équipe)
- Membre de l'équipe : 70 000 00 99
- Chauffeurs validés : 70 000 00 01 à 70 000 00 05 · candidature en attente : 70 000 00 09
- Clients : 70 000 00 11 à 70 000 00 14, ou n'importe quel nouveau numéro

## Déployer sur Cloudflare

Prérequis : Node.js 20 ou plus, un compte Cloudflare. Le site est un **Worker Cloudflare avec fichiers statiques** : un seul déploiement sert la vitrine, les trois espaces et l'API. Le glisser-déposer du tableau de bord ne convient pas (il refuse les projets avec `wrangler.toml`) : utilisez le terminal, dans le dossier `bokk-yoon`.

```bash
npm install
npx wrangler login
npx wrangler d1 create bokk-yoon-db      # copier le database_id dans wrangler.toml
npm run db:init                           # crée les tables
# dans wrangler.toml : ADMIN_PHONES = "+2217XXXXXXXX" (votre numéro = propriétaire)
npm run deploy
```

Ouvrez ensuite `https://bokk-yoon.<votre-sous-domaine>.workers.dev/admin/` (adresse affichée à la fin du déploiement), connectez-vous avec votre numéro, puis dans **Journal**, cliquez sur **Ajouter les données de démo** si vous voulez une base d'exemple. Pour une vraie ouverture, ne l'ajoutez pas.

Nom de domaine (ex. bokkyoon.sn) : tableau de bord Cloudflare → Workers & Pages → bokk-yoon → Paramètres → Domaines et routes.

### Mettre à jour un déploiement existant (version 1 ou 2)

Le schéma a changé en version 3 (références, types d'envoi, factures, messages, retours, codes promo). Sur une base de test, le plus simple est de recréer la base : `npx wrangler d1 delete bokk-yoon-db`, puis `create` et `db:init`. En mode démo, la base locale du navigateur est recréée automatiquement (clé `bokkyoon-demo-db-v4`).

## Développer en local

```bash
npm install
npm run db:init:local
npm run dev     # http://localhost:8788
npm test        # 23 tests de bout en bout de l'API
```

## Réglages

Dans `wrangler.toml` → `[vars]` :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DEMO_OTP` | `true` | Affiche le code SMS à l'écran. **À passer à `false`** dès que l'envoi de SMS est branché. |
| `ADMIN_PHONES` | `+221770000000` | Numéro(s) du propriétaire. Les membres de l'équipe sont ajoutés ensuite depuis l'espace équipe. |
| `AUTO_APPROVE_DRIVERS` | absent | `true` valide les chauffeurs sans revue (déconseillé). |
| `SMS_WEBHOOK_URL` / `SMS_TOKEN` | vide | Envoi des SMS (code de connexion, lien de suivi du destinataire). Voir `sendSms` dans `public/assets/server.js`. |
| `RESEND_API_KEY` / `EMAIL_FROM` | vide | Envoi des e-mails via Resend (copie au propriétaire de chaque message reçu, réponses aux visiteurs). `EMAIL_FROM` = adresse d'un domaine vérifié chez Resend. |
| `OWNER_EMAIL` | e-mail de l'entreprise | Adresse qui reçoit les messages du formulaire de contact. |
| `EMAIL_WEBHOOK_URL` | vide | Alternative à Resend : un webhook (Make, n8n, Zapier…) reçoit `{to, subject, text}`. |

Mettez les clés secrètes avec `npx wrangler pages secret put RESEND_API_KEY` plutôt que dans `wrangler.toml`.

Dans l'espace équipe → **Tarifs** (propriétaire) : prix au km (place et colis), minimums, supplément par kg, part reversée au chauffeur, arrondi, délai de paiement, délai de versement, règle de remboursement, et **grille par axe** (prix client et part chauffeur fixés à la main, prioritaires sur la formule).

## Nouveautés de la version 3

- **Références uniques** : CL00001 (client), CH0001 (matricule chauffeur), EQ01 (équipe), TR-26-00001 (trajet), COL-26-00001 (colis), RES-26-00001 (réservation), VER-26-0001 (versement), LIT / SIG (litige, signalement), SUP-26-0001 (message). Recherche globale dans l'espace équipe.
- **Types d'envoi sans poids** (Tarifs → Types d'envoi) : passeport, enveloppe, clés, ou tout type que vous créez, avec un prix forfaitaire = base + montant par km, pour le client et pour le chauffeur. Option « vérification de pièce » à la remise.
- **Factures professionnelles** : facture automatique à chaque paiement (FAC-2026-00001, numérotation continue par année), avoir automatique à chaque remboursement (AV-…), factures manuelles avec éditeur de lignes. Montant en lettres, QR code, TVA optionnelle, tampon Payée / À payer. **Designer** (Entreprise et facture) : logo, couleur, 3 modèles, mentions légales (NINEA, RCCM), aperçu en direct. Impression A4 ou PDF depuis le navigateur ; étiquette colis 10 × 15 cm ; relevé mensuel du chauffeur.
- **Contact intégré** : boutons WhatsApp, e-mail et appel partout (numéro réglé dans Entreprise et facture), bouton WhatsApp flottant, formulaire sur le site et dans chaque espace. Les messages arrivent dans **Messages reçus** (et par e-mail si Resend est configuré) ; vous répondez dans l'application, par WhatsApp ou par e-mail.
- **Formulaire de retour** en fin de trajet (note 0 à 10, NPS) et page **Retours clients**. Note ≤ 6 signalée à l'équipe.
- **Calculatrices** : prix public sur le site et dans l'espace client ; côté équipe, rentabilité d'un trajet, marge nette, TVA et calculette.
- **Codes promo** (la remise sort de votre marge, pas de la part chauffeur).
- **Exports CSV** (réservations, factures, versements, chauffeurs, clients, messages), ouverts directement dans Excel.

## Encaisser avec votre QR code Wave / Orange Money

Votre QR code Wave est **déjà intégré** (`public/assets/pay/wave-qr.png`, lien `https://qr.wave.com/…`). Mode par défaut « AUTO » : paiement réel par QR une fois déployé sur Cloudflare, paiement simulé dans la démo. Vous pouvez le remplacer ou ajouter Orange Money à tout moment :

Espace équipe → **Encaissements Wave / OM** (propriétaire) :

1. Chargez l'image de votre QR code Wave, compte personnel ou marchand (une capture d'écran suffit), (et/ou Orange Money). Le QR est lu automatiquement : s'il contient un lien de paiement (`https://pay.wave.com/m/…`), il est rempli pour que les clients sur téléphone puissent ouvrir Wave d'un geste.
2. Indiquez le numéro et le nom affiché, puis passez le mode sur **QR code réel** et enregistrez.
3. Le client voit le montant exact, votre QR code, le bouton « Ouvrir Wave », puis colle l'**ID de la transaction**. Sa place reste réservée pendant la vérification.
4. Vous recevez une notification (et un e-mail si Resend est configuré). Vérifiez dans votre application Wave que le montant est bien arrivé, puis **Confirmer** : réservation payée, code client, facture, chauffeur prévenu. Sinon **Refuser** avec un motif : le client a 30 minutes pour corriger.

Un ID de transaction ne peut servir qu'une fois. Si la réservation a été annulée entre-temps, la déclaration passe en « À rembourser ».

Étape suivante possible : l'API **Wave Business Checkout** (session de paiement + webhook signé) confirme automatiquement, sans vérification manuelle. La fonction `capturePayment` du serveur est déjà prête à être appelée par ce webhook.

## Géolocalisation et carte

- Carte Leaflet (fournie dans `assets/vendor/leaflet`) avec fond OpenStreetMap et **limites administratives officielles** : 14 régions colorées, 45 départements et 121 arrondissements (sélecteur en haut à droite). Source : geoBoundaries, données du Gouvernement du Sénégal diffusées par OCHA (licence CC BY 3.0 IGO, attribution affichée sur la carte). Limites : le découpage en communes n'est pas publié en données ouvertes à ce niveau, et le département de Keur Massar (créé en 2021) est encore inclus dans celui de Pikine.
- Carte du Sénégal dans l'espace équipe : réservations, chiffre d'affaires, trajets ou chauffeurs par région.
- 54 villes réparties dans les 14 régions, sélection groupée par région, bouton « Me localiser » (ville la plus proche).
- Pendant un trajet, le téléphone du chauffeur envoie sa position toutes les 20 secondes. Le client, le destinataire et l'équipe (carte en direct) la voient. Sans GPS, une position estimée selon l'horaire est affichée, avec la mention.
- Pour un trafic important, remplacer les tuiles `tile.openstreetmap.org` par un fournisseur de tuiles (MapTiler, Stadia, Protomaps) : la politique d'usage d'OpenStreetMap interdit un usage intensif de ses serveurs.

## Ce qui est simulé et à brancher avant d'ouvrir au public

1. **Encaissement** : `POST /client/bookings/{id}/pay` crée un paiement « SIM-… ». Brancher Wave Business ou un agrégateur (PayDunya, PayTech, CinetPay…), valider sur webhook signé.
2. **Versements aux chauffeurs** : le propriétaire paie depuis son compte marchand puis saisit la référence dans l'espace équipe. On peut automatiser avec l'API de décaissement du prestataire.
3. **SMS** : rien n'est envoyé tant que `SMS_WEBHOOK_URL` est vide.
4. **Photos** (pièces, permis, colis) : demandées mais pas téléversées. Prévoir Cloudflare R2 avec liens signés et accès réservé à l'équipe.
5. **Distances** : vol d'oiseau × 1,25. Remplacer par OSRM (données OpenStreetMap du Sénégal) pour les détours exacts.
6. **Factures** : conformes dans leur forme, mais faites valider les mentions obligatoires et le régime de TVA par votre comptable.
7. **Cadre légal** : avec des prix fixés par l'opérateur et des chauffeurs rémunérés, l'activité relève du transport de personnes et de la messagerie (colis) : statut des chauffeurs, autorisation de transport, déclaration CDP (loi n° 2008-12), agrément de paiement. Le transport de passeports et documents d'identité engage aussi votre responsabilité : conditions générales spécifiques et assurance à prévoir. À valider avec un juriste sénégalais.

## API partenaires (boutiques en ligne)

```
POST /api/partner/v1/eligibility   { from, to, weightKg, dateTo? }  → { eligible, price, currency }
POST /api/partner/v1/shipments     { from, to, weightKg, category, recipientName, recipientPhone, externalRef }
GET  /api/partner/v1/shipments/:id → statut, code d'enlèvement, lien de suivi
```

En-tête `x-api-key` (clé créée dans Profil → boutique). Montant provisionné sur le compte partenaire, facturé à la livraison. Webhooks signés HMAC-SHA256 (`x-bokkyoon-signature`) : `shipment.confirmed`, `shipment.picked_up`, `shipment.delivered`, `shipment.cancelled`.

## Structure

```
public/
  index.html             site vitrine          app/index.html        espace client
  chauffeur/index.html   espace chauffeur      admin/index.html      espace équipe
  assets/
    core.js      règles métier : villes et régions, tarifs, matching, position estimée
    server.js    toute l'API (Cloudflare ET mode démo)
    schema.sql   tables D1
    api.js       client HTTP, sessions par espace, bascule en mode démo
    ui.js        composants partagés (connexion, notifications, actualités, alertes)
    client.js · driver.js · admin.js · landing.js
    map.js       carte (Leaflet + contour du Sénégal)
    styles.css · landing.css · icon.svg
    vendor/      sql.js (mode démo), Leaflet
  sw.js · manifest.webmanifest · _headers
src/worker.js                point d'entrée Cloudflare : /api/* → API, le reste → fichiers de public/
tests/api.test.mjs           tests
```

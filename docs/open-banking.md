# Récupération des dépenses : notes (10/11/2026)

Synthèse du fil « Expense Tracker Data Retrieval ».

## Options pour récupérer les dépenses

1. **Open Banking (DSP2) via un agrégateur.** C'est l'option retenue.
   - **Enable Banking** : gratuit pour relier ses propres comptes. C'est le choix retenu.
   - GoCardless Bank Account Data (ex-Nordigen) : les nouvelles inscriptions sont restreintes.
   - Powens, Bridge, Tink, TrueLayer : orientés pros, payants.
   - Fonctionnement : lien de consentement → connexion à la banque → `account_id` → `GET /accounts/{id}/transactions` en cron.
   - Le consentement dure 90 à 180 jours, puis il faut le renouveler. Il y a environ 4 appels par jour et par compte.
2. **API directe de la banque** : Qonto, Revolut Business, Monzo… Les banques classiques n'en ont pas pour les particuliers.
3. **Scraping** avec Woob (Python). C'est fragile et il faut stocker ses identifiants.
4. **Semi-automatique** : import CSV/OFX/QIF, parsing des e-mails, OCR des tickets.

Plan conseillé :
1. Commencer par l'import CSV, pour poser le modèle de données et la catégorisation.
2. Brancher Enable Banking.
3. Dédoublonner par ID de transaction, ou par un hash `date + montant + libellé`.

Pour l'inspiration : Actual Budget, Firefly III.

## Couverture des banques (vérifiée en prod le 11/11/2026, `check` + `list -Country FR`)

| Banque | Statut | Remarque |
|---|---|---|
| BNP Paribas | ✅ | Validation dans l'app « MesComptes ». Consentement max 180 j. |
| Société Générale | ✅ connectée | Notification dans « L'Appli SG ». Marquée « beta » chez Enable Banking. Consentement max 180 j. |
| Trade Republic | ✅ | Montant, devise et date seulement, **sans libellé**. Consentement max 90 j. |
| Revolut | ✅ | Disponible en FR (particulier et pro). Consentement max 180 j. |
| Fortuneo | ✅ | Disponible en FR (particulier). Consentement max 180 j. |
| Natixis Interépargne | ❌ | Absente des 132 banques FR : épargne salariale, hors DSP2. Même chose pour les PEA et comptes-titres. |

## Script de test : `scripts/eb.ps1` (PowerShell 5.1)

Python et Node ne sont pas installés sur la machine. Le JWT RS256 est donc signé avec l'openssl de Git (`C:\Program Files\Git\mingw64\bin\openssl.exe`).

```powershell
$env:EB_APP_ID   = "<UUID de l'app>"         # le nom du .pem téléchargé est l'UUID
$env:EB_KEY_PATH = "C:\chemin\vers\cle.pem"
.\scripts\eb.ps1 list -Country FR             # banques dispo dans le pays
.\scripts\eb.ps1 check                        # dispo des 6 banques visées
.\scripts\eb.ps1 auth -Bank "BNP Paribas" -Country FR
.\scripts\eb.ps1 session -Code "<URL localhost complète>"
.\scripts\eb.ps1 tx -Days 30                  # soldes et transactions
```

- La redirect URL de l'app est `https://localhost/callback`. Après la connexion à la banque, la page affiche `ERR_CONNECTION_REFUSED` : **c'est normal**. Il suffit de copier l'URL de la barre d'adresse, qui contient `code=...`.
- Les sessions sont stockées dans `scripts/sessions.json`. Ce fichier est ignoré par git.
- Le fichier doit rester en UTF-8 **avec BOM**, sinon les accents s'affichent mal sous PowerShell 5.1.

## État actuel

- **11/11/2026 : app Production `SelfFinance` active** (clé `d3b72a02-….pem` dans Téléchargements).
  - `check` FR : BNP, SG, Revolut, Fortuneo et Trade Republic sont disponibles. Natixis Interépargne est absente.
  - **SG connectée.** Un compte, consentement valable jusqu'au 08/02/2027. `tx` remonte bien les vraies transactions.
  - Solde SG à **0,00 €** (type `XPCD`) : **c'est le vrai solde** (confirmé le 11/11/2026). Le compte sert de compte de passage, l'argent repart aussitôt (IBKR, Fortuneo, Revolut). Aucun solde manuel à saisir.
  - Le premier essai SG a renvoyé `invalid_request`. Le deuxième a marché en cochant le même compte que celui lié dans le Control Panel.
  - Bug corrigé : PowerShell 5.1 décodait les réponses en Latin-1. La fonction `Call` relit maintenant les octets en UTF-8.
  - La session sandbox a été archivée dans `scripts/sessions.sandbox.json`.

### Historique sandbox

- L'app **Sandbox** est créée et la clé est dans Téléchargements. Le flux complet a été validé sur la fausse banque **Mock ASPSP** : 1 compte, session valable jusqu'au 08/02/2027, 0 transaction car le compte de test est vide.
- Le sandbox ne contient que 3 fausses banques en France (BBVA, Genome, Mock ASPSP). Aucune vraie banque.
- Piège rencontré : le compte Mock d'exemple, de type `CARD` et sans IBAN, provoquait `error=invalid_request`. Le compte suivant fonctionne :
  ```json
  { "name": "Compte courant test", "cash_account_type": "CACC", "currency": "EUR",
    "usage": "PRIV", "bic_fi": "BNKAFRPPXXX",
    "account_id": { "iban": "FR7630006000011234567890189" } }
  ```

## Prochaines étapes

1. (Facultatif) Ajouter un solde et des transactions au compte Mock (« Balances & Transactions »), puis relancer `tx`.
2. Créer une app **Production** sur Enable Banking (gratuit en usage perso), avec la même redirect URL, et télécharger la clé `.pem`.
3. Lancer `check`, puis connecter BNP ou SG pour voir les vraies dépenses.
4. Dans l'app finale, remplacer le copier-coller de l'URL `localhost` par une vraie page de callback.

## Sources

- https://enablebanking.com/docs/markets/fr/
- https://enablebanking.com/docs/markets/de/
- https://enablebanking.com/docs/api/quick-start/
- https://enablebanking.com/terms
- https://www.openbankingtracker.com/guides/free-open-banking-apis

## Comptes d'investissement (PEA, CTO, épargne salariale) : à traiter plus tard

L'Open Banking (DSP2) ne couvre que les comptes de paiement. Les PEA, CTO, assurances-vie et l'épargne salariale ne remontent pas par Enable Banking. Pour Trade Republic, seul le compte espèces remonte.

| Courtier | API officielle ? | Option retenue |
|---|---|---|
| **IBKR** | ✅ | **Flex Web Service**, en lecture seule. Créer un token et une Flex Query (Open Positions + Trades) dans Client Portal → Settings → Data Feeds. Le token est valable environ 1 an. C'est un flux en deux étapes : SendRequest (token + query id) → code de référence → GetStatement. |
| **Trade Republic** | ❌ | Saisie manuelle. Plus tard, éventuellement `pytr` (API privée non officielle, fragile, 2FA, probablement contraire aux conditions d'utilisation). |
| **Fortuneo** (PEA/CTO) | ❌ | Saisie manuelle des positions (ISIN + quantité), avec les cours mis à jour automatiquement. |
| **Revolut** (actions) | ❌ | Saisie manuelle, ou import du relevé de trading. L'API Revolut est réservée à Business. |
| **Natixis Interépargne** | ❌ | Saisie de chaque fonds (code AMF + nombre de parts). La valeur liquidative est récupérée automatiquement quand elle est publique (voir ci-dessous). |

### Natixis Interépargne : valeur des FCPE

- Les FCPE ne sont pas cotés. Chacun a un **code AMF** (ex. `990000128749`), parfois aussi un ISIN. On les trouve sur le relevé ou sur le DIC du fonds.
- La valeur liquidative est publiée au moins une fois par mois, souvent chaque jour ou chaque semaine.
- Où la trouver :
  1. dans l'Espace Épargnants (interepargne.natixis.com), avec connexion ;
  2. dans la **base AMF GECO / ROSA**, sous forme de fichiers téléchargeables, donc automatisable côté serveur. Les valeurs postérieures au 01/03/2024 sont dans les fichiers ROSA ;
  3. auprès de la société de gestion (ex. im.natixis.com).
- **Limite :** les fonds **dédiés** et professionnels, comme ceux d'actionnariat salarié propres à une entreprise, ne sont pas publiés par l'AMF. Il faudra les saisir à la main, environ une fois par mois.
- À faire : relever le nom et le code AMF de chaque fonds sur le relevé, puis vérifier lesquels sont présents dans GECO / ROSA.
- **11/11/2026 : pas d'automatisation pour l'instant.** GECO est une application web, sans fichier ni accès direct par fonds lisible par un serveur, et rien d'exploitable n'a été trouvé sur data.gouv. Dans l'app, les FCPE se saisissent donc à la main (cours manuel). La fonction `quotes` garde un fournisseur `amf` vide, prêt à être branché si une source est trouvée.

Sources :
- [IBKR Flex Web Service](https://www.interactivebrokers.com/campus/ibkr-api-page/flex-web-service)
- [pytr](https://github.com/pytr-org/pytr)
- [AMF – où trouver la VL](https://www.amf-france.org/sites/institutionnel/files/pdf/60711/fr/Ou_trouver_la_valeur_liquidative_d%27un_OPC_.pdf?1713611403)
- [AMF – note ROSA](https://geco.amf-france.org/Bio/Bio/BIO_PDFS/ROSA_DATA/Note%20d'accompagnement%20fichiers%20ROSA%20pour%20GECO.pdf)

## Saisie manuelle (à prévoir dans l'app)

- **Livret A** : pas récupéré par l'Open Banking. Les comptes d'épargne ne sont pas couverts par la DSP2 et la session SG ne contient que le compte courant. Décision : saisie manuelle du solde.
- **« BQ CHAS CPT 31412815 »** sur les relevés SG : c'est le **compte IBKR** (dépôts reçus via J.P. Morgan Chase, code banque CHAS). Ce sont des virements internes vers IBKR, pas des dépenses. Le compte sera suivi via le Flex Web Service.

- **11/11/2026 : implémenté** dans l'onglet Patrimoine de l'app (comptes manuels, positions, cours Yahoo Finance, plus-values). Voir `docs/superpowers/specs/2026-11-11-patrimoine-design.md`.

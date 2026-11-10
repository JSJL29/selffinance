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

## Couverture des banques (doc Enable Banking, pas encore vérifiée en prod)

| Banque | Statut | Remarque |
|---|---|---|
| BNP Paribas | ✅ | Validation dans l'app « MesComptes ». |
| Société Générale | ✅ | Notification dans « L'Appli SG ». |
| Trade Republic | ✅ | Montant, devise et date seulement, **sans libellé**. |
| Revolut | ❓ | À vérifier avec `check`. |
| Fortuneo | ❓ | À vérifier avec `check`. |
| Natixis Interépargne | ❌ probable | C'est de l'épargne salariale, hors DSP2. Même chose pour les PEA et comptes-titres. |

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

# Ventes, dividendes et bilan fiscal (conception)

Date : 11/11/2026 · Statut : proposé · Suite de `2026-11-11-patrimoine-design.md`

## Intention

Le propriétaire veut **vendre une ligne** dans l'app (prix de vente) pour connaître sa **plus ou moins-value réalisée**, voir un **bilan par année** et une **estimation de ce qu'il devra déclarer** pour ses CTO, afin d'arbitrer en fin d'année (réaliser des moins-values pour compenser des plus-values, vendre/racheter). Il veut aussi suivre ses **dividendes**. IBKR doit remonter **automatiquement** (ventes et dividendes) ; le reste se saisit **à la main**.

## Règles fiscales retenues (France, 2026)

- **CTO** : plus et moins-values **réalisées** de l'année s'additionnent, **tous CTO confondus** (ex. +20 et −10 → +10 imposable). Une moins-value nette se reporte sur les plus-values des **10 années suivantes**. Les moins-values latentes (non vendues) ne comptent pas.
- **Dividendes CTO** : imposables (montant brut). Les courtiers français prélèvent à la source un acompte d'impôt et les prélèvements sociaux ; un courtier étranger (IBKR) non.
- **Flat tax (PFU)** : **31,4 %** (12,8 % IR + 18,6 % prélèvements sociaux) depuis 2026. Taux réglable dans l'app.
- **PEA** : ventes et dividendes **non imposés** au fil de l'eau (seuls les retraits comptent). Affiché à titre indicatif, hors estimation.
- Hors périmètre de l'estimation : assurance-vie, PER, épargne salariale, crypto (régimes différents).
- L'app donne une **estimation**, pas une déclaration : la méthode exacte (taux de change au jour d'achat et de vente pour les titres en devises, frais, abattements, option pour le barème) peut donner un résultat différent. Le relevé fiscal (IFU) des courtiers français fait foi.

## Objectifs

1. **Vendre** tout ou partie d'une position manuelle : quantité, prix de vente unitaire, frais, date. La position diminue ; le **PRU des titres restants ne change pas** (prix moyen pondéré, méthode des courtiers français). Plus-value réalisée = (prix de vente − PRU) × quantité − frais.
2. **Dividendes** manuels : compte, titre (facultatif), date, montant brut, impôt déjà prélevé (facultatif), devise.
3. **IBKR automatique** : ventes (avec la plus-value réalisée calculée par IBKR) et dividendes / retenues à la source récupérés par la synchro existante.
4. **Bilan fiscal par année** : plus/moins-values réalisées par compte, total net CTO, moins-values reportées, dividendes CTO, impôt estimé, déjà prélevé, reste estimé ; PEA à part.
5. **Historique des opérations** visible sur la page de chaque compte ; une opération manuelle se supprime (la vente supprimée rend les titres à la position).

## Non-objectifs

- Saisie des **achats** comme opérations (les achats restent la mise à jour de la position, comme aujourd'hui).
- Calcul exact « à la française » des plus-values en devises (taux du jour d'achat et du jour de vente) ; la conversion se fait au taux du jour de l'opération.
- Formulaires fiscaux (2074, 2086, 3916), option pour le barème progressif, crédits d'impôt sur dividendes étrangers.
- Opérations sur titres (divisions, fusions), produits dérivés.

## Anti-objectifs

- Présenter l'estimation comme un montant certain : toujours libellée « estimation », avec la date et le taux utilisés.
- Compter deux fois une opération IBKR (la synchro est rejouée chaque jour) : import **idempotent**.
- Mélanger PEA et CTO dans le total imposable.

## Approches envisagées

| | Approche | Avantages | Inconvénients |
|---|---|---|---|
| **1 (retenue)** | Table d'**opérations** (vente, dividende) rattachée aux comptes ; IBKR importé via les sections *Trades* et *Cash Transactions* de la Flex Query | Historique conservé par année ; IBKR sans saisie ; prépare l'historique complet (achats plus tard) | Un peu plus de code |
| 2 | Champ « plus-value réalisée » cumulé sur la position | Très simple | Pas d'historique, pas de bilan par année, ventes multiples perdues |
| 3 | IBKR saisi à la main | Moins de code | Risque d'oubli sur le compte qu'il faut justement déclarer soi-même |

**Choix du propriétaire : 1, IBKR automatique, le reste manuel.**

## Modèle de données (proposition)

- **`operations`** : `id uuid`, `account_id → manual_accounts on delete cascade`, `instrument_id → instruments` (null possible pour un dividende sans titre), `kind` (`sell` | `dividend` | `withholding`), `date date`, `quantity numeric` (ventes), `price numeric` (prix unitaire de vente), `fees numeric default 0`, `amount numeric` (dividende brut, ou retenue négative), `currency text`, `avg_cost numeric` (PRU au moment de la vente, figé), `tax_withheld numeric` (dividendes : impôt déjà prélevé par un courtier français), `cash_credit numeric` (montant ajouté aux liquidités du compte, dans la devise du compte ; repris à l'annulation), `realized numeric` (plus-value réalisée dans la devise de l'opération), `fx_per_eur numeric` (taux de la devise au jour de l'opération : 1 EUR = x devise), `source` (`manual` | `ibkr`), `external_id text` (identifiant IBKR, unique par `(source, external_id)`), `note text`, `created_at`.
- **`tax_settings`** (une ligne par année) : `year int primary key`, `pfu_rate numeric default 0.314`, `carried_losses numeric default 0` (moins-values reportables des années antérieures, saisies par le propriétaire en € pour l'instant).
- **Vues** (`security_invoker`) :
  - `operation_view` : opérations + nom du titre et du compte, `envelope`, montants en EUR (`realized_eur`, `amount_eur` = montant / `fx_per_eur`).
  - `tax_year_view` (ou fonction `tax_summary(year)`) : par année, totaux CTO (plus-values, moins-values, net, après report), dividendes CTO bruts, retenues, impôt estimé = max(0, net après report) × taux + dividendes × taux, déjà prélevé, reste ; totaux PEA indicatifs.
- RLS : `is_app_user()` comme le reste.

## Vente manuelle (règles)

- Quantité vendue ≤ quantité détenue. Prix et frais dans la **devise du PRU** de la position.
- Enregistrement atomique (fonction SQL `sell_position(...)`) : insère l'opération avec `avg_cost` et `realized`, diminue la quantité ; **à 0 la position est supprimée** (l'opération garde le titre).
- **Les liquidités du compte sont créditées automatiquement** du produit net (quantité × prix − frais), converti dans la devise du compte au taux du jour si besoin. *(choix du propriétaire)*
- Suppression d'une vente manuelle (fonction `undo_sell(op_id)`) : rend la quantité à la position et **retire le produit net des liquidités**. Si la position existe encore, les titres rendus sont fusionnés au PRU figé de la vente (moyenne pondérée, comme un rachat) ; sinon la position est recréée au PRU figé. *(choix de Claude)*
- `fx_per_eur` pris dans `fx_rates` au moment de la saisie (taux du jour).

## Dividendes manuels (règles)

- Champs : montant brut, **impôt déjà prélevé par le courtier** (colonne `tax_withheld`, facultative, ex. acompte 12,8 % + prélèvements sociaux d'un courtier français), devise, date, titre facultatif.
- **Liquidités créditées** du montant net (brut − impôt déjà prélevé) ; suppression du dividende = débit inverse. *(choix du propriétaire)*

## Calcul du bilan *(choix de Claude)*

- **Déjà prélevé** = somme des `tax_withheld` des dividendes CTO de l'année (courtiers français). Il est déduit de l'impôt estimé.
- **Retenues étrangères** (IBKR `withholding`, ex. 15 % sur dividendes US) : affichées à part, **non déduites** (crédit d'impôt hors périmètre).
- **Moins-values reportées** : saisies à la main par année (`tax_settings.carried_losses`). Si le net CTO de l'année est négatif, le bilan affiche « moins-value à reporter sur l'année suivante ».
- Impôt estimé = max(0, net CTO − report) × taux + dividendes CTO bruts × taux ; reste estimé = impôt estimé − déjà prélevé.
- La devise de base du compte IBKR est **EUR** (vérifié le 11/11/2026) : `fx_per_eur = 1 / fxRateToBase`.

## IBKR automatique

- Le propriétaire ajoute à sa Flex Query :
  - **Trades** (niveau *Execution*) : TradeID, Conid, Symbol, ISIN, Description, Asset Class, Currency, FX Rate To Base, Trade Date, Quantity, Trade Price, IB Commission, Buy/Sell, FIFO Realized P&L ;
  - **Cash Transactions** : Type, Conid, Description, Currency, FX Rate To Base, Date/Time, Amount, Transaction ID ;
  - **Période : Last 365 Calendar Days** (au lieu de Last Business Day) pour que l'année entière soit couverte ; l'import étant idempotent, les jours déjà vus ne sont pas recréés. Les positions et liquidités restent celles de la fin de période (aujourd'hui).
- Ventes (`Buy/Sell = SELL`) → `operations` `kind=sell`, `realized = fifoPnlRealized`, `fx_per_eur = 1 / fxRateToBase` si la devise de base IBKR est EUR. Les achats IBKR ne sont pas importés (non-objectif).
- Cash Transactions `Dividends` → `kind=dividend` ; `Withholding Tax` → `kind=withholding` (montant négatif).
- Clé d'idempotence : `external_id` = TradeID / Transaction ID.
- Si les sections sont absentes du relevé, la synchro continue comme aujourd'hui (positions + liquidités) sans erreur.

## Écrans (proposition)

```
Page d'une position              Bilan fiscal 2026
┌──────────────────────────┐     ┌──────────────────────────────┐
│ Amazon · 3 × 270,87 $    │     │ ‹ Patrimoine     2025 [2026] │
│ [Modifier] [Vendre]      │     │ CTO (imposable)              │
└──────────────────────────┘     │  CTO IBKR        +146,76 €   │
Vendre                           │  CTO Boursorama   −40,00 €   │
┌──────────────────────────┐     │  Net               +106,76 € │
│ Quantité (max 3)   [ 1 ] │     │  Report antérieur    −0,00 € │
│ Prix de vente ($) [300 ] │     │  Dividendes CTO     +12,30 € │
│ Frais ($)          [ 1 ] │     │  Impôt estimé (31,4 %) 37 €  │
│ Date         11/11/2026  │     │  Déjà prélevé          4 €   │
│ Plus-value : +58,16 $    │     │  Reste estimé         33 €   │
│ [Vendre]                 │     │ PEA (non imposé)  +210,00 €  │
└──────────────────────────┘     │ Estimation, IFU fait foi     │
                                 └──────────────────────────────┘
```

- Onglet Patrimoine : lien **« Bilan fiscal »** sous le total.
- Page d'un compte : section **Opérations** (ventes et dividendes, plus récents d'abord) ; bouton **« Ajouter un dividende »** (comptes manuels).
- Formulaire de position : bouton **« Vendre »** (positions manuelles) ; aperçu de la plus-value avant validation.
- Bilan fiscal : choix de l'année, taux PFU et moins-values reportées modifiables.

## Laissé au constructeur

- Noms exacts des fonctions SQL et découpage des migrations.
- Présentation précise des écrans, dans le style existant.
- Formats exacts des attributs XML des sections Trades / Cash Transactions (à vérifier sur un vrai relevé ; parser testé sur un exemple).

# Virements internes — conception (courte)

Date : 2026-11-13 · Statut : à valider

## Intention
Un virement entre ses propres comptes ne doit ni enrichir ni appauvrir : il déplace de l'argent.
1. **Vers / depuis un compte manuel** (Livret A, PEA…) : le solde du compte manuel suit tout seul.
2. **Entre deux banques synchronisées** (SG → BNP) : une seule ligne « SG → BNP », pas un −x et un +x.

## Constat
- Détection actuelle : règles `internal_rules` (regex sur contrepartie + libellé) → `is_internal`, ligne grisée,
  exclue des totaux de l'onglet Transactions. Le montant reste affiché signé.
- Aucun lien avec les comptes manuels. Exemple réel non reconnu : « VIR S/ PEA 1451… » (−500 €, Fortuneo, 06/11).

## Approches (choix de l'utilisateur : A et A)
| Point | ✅ Choisi | Écarté |
|---|---|---|
| 1. Comptes manuels | **Calcul en direct dans la vue** : solde saisi + virements correspondants arrivés après la date de saisie ; rien n'est stocké en double | Écrire le crédit dans le solde à chaque synchro (risque de doublon : la synchro réécrit les opérations récentes) |
| 2. Fusion SG → BNP | **Dans l'app, à l'affichage** (fonction pure testée) | En base à chaque synchro (paires à recalculer après chaque réécriture) |

## Conception

### 1. Comptes manuels (migration)
- `manual_accounts` : `transfer_pattern text` (texte simple, recherché sans tenir compte de la casse dans
  contrepartie + libellé, ex. « VIR S/ PEA », « LIVRET A ») et `transfers_from date`.
- `transfers_from` = jour où l'on a renseigné le libellé ou saisi le solde à la main ; seuls les virements
  **strictement après** ce jour comptent (le solde saisi ce jour-là est supposé les inclure).
- `manual_account_view` ajoute `transfers` (somme, dans la devise du compte, de `−montant` des opérations
  correspondantes ; taux absent → `null`, jamais 1) ; `cash_eur` et `value_eur` l'incluent.
  Comptes synchronisés (IBKR) exclus : leurs liquidités viennent du relevé.
- Classement : une opération qui correspond au libellé d'un compte manuel devient interne, étiquette = nom du compte.
  Changer un libellé reclasse les opérations.
- La photo de 22 h et le total du Patrimoine en profitent sans changement (ils lisent la vue).

### 2. Fusion des virements entre banques (app)
- `src/lib/transfers.ts` (pur, testé) : `pairTransfers(txs)` → liste d'éléments `tx` ou `transfer { out, in }`.
  Paire = deux opérations internes, de comptes différents, montants opposés dans la même devise, à ≤ 3 jours
  d'écart ; on prend la plus proche en date ; chaque opération n'est utilisée qu'une fois.
- Onglet Transactions : une paire s'affiche en une ligne « SG → BNP » avec le montant sans signe, couleur neutre.
  Totaux inchangés (les internes en sont déjà exclus).
- Hors périmètre : la page d'un compte (un seul côté visible) et les paires à cheval sur deux mois (restent deux lignes).

### Écrans
- Édition d'un compte manuel : champ « Libellé des virements » (facultatif) avec une aide (« ex. VIR S/ PEA »).
- Page du compte manuel : sous le solde, « dont +1 400 € de virements depuis le 13 nov. » quand `transfers ≠ 0`.

## Laissé au constructeur
Libellé exact de l'aide, icône de la flèche, ordre de tri d'une paire dans la journée (date du débit).

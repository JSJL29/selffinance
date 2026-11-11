-- Secrets de ta copie de SelfFinance, rangés dans le coffre Supabase (Vault).
--
-- 1. Copie ce fichier en `supabase/setup/secrets.sql` (ce nom est exclu de git).
-- 2. Remplace chaque <…> par ta valeur.
-- 3. Colle le contenu dans Supabase → SQL Editor → Run.
--
-- Pour modifier un secret plus tard :
--   select vault.update_secret((select id from vault.secrets where name = 'eb_app_id'), '<nouvelle valeur>');

-- Adresse de ton projet (Project Settings → API → Project URL), sans « / » final.
select vault.create_secret('https://<ref-du-projet>.supabase.co', 'project_url');

-- Secret partagé entre le cron et les fonctions : généré au hasard, rien à remplir.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'sync_secret');

-- ID de ton application Enable Banking (Control Panel ; c'est aussi le nom du fichier .pem).
select vault.create_secret('<uuid-de-l-app-enable-banking>', 'eb_app_id');

-- Facultatif : IBKR (Flex Web Service). Supprime ces deux lignes si tu n'as pas IBKR.
select vault.create_secret('<query-id-flex>', 'ibkr_query_id');
select vault.create_secret('<jeton-flex>', 'ibkr_token');

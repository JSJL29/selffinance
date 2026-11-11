-- Résultat de chaque connexion, relu par l'app à la fermeture du navigateur
-- (au cas où la redirection vers l'app n'aboutit pas).
alter table public.bank_auth_requests add column result jsonb;

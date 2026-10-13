-- Nom choisi pour chaque wallet rapide (32 caractères au plus) ; sans nom, « Wallet rapide n°… »
alter table public.server_wallets add column if not exists label text check (label is null or char_length(label) between 1 and 32);

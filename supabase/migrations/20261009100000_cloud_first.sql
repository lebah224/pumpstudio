-- Les données du compte vivent dans la base (plus de copie dans le navigateur) :
-- la vignette de chaque token (petite image ~96 px) est gardée avec lui.
alter table public.tokens add column if not exists thumb text check (thumb is null or (char_length(thumb) <= 24000 and thumb ~ '^data:image/(png|jpeg|webp);base64,'));

import { createClient } from '@supabase/supabase-js';

// Valeurs publiques : la clé « publishable » est faite pour le navigateur, la sécurité repose sur les règles RLS.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://juuytckoiheivddkkrgk.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_c_6RryqoNBffJHr4ySDA8A_pduMPyZm';

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce', // le lien e-mail est échangé contre une session côté navigateur, jamais réutilisable
    storageKey: 'tokenstudio-auth',
  },
});

export const FUNCTIONS_URL = url.replace(/\/$/, '') + '/functions/v1';
export const PUBLISHABLE_KEY = key;

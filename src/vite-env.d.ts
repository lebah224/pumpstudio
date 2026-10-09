/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** clé de site Cloudflare Turnstile (case « Je ne suis pas un robot ») ; vide : case désactivée */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.js';

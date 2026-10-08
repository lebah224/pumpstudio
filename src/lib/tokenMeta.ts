import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Envoi du logo et de la fiche d'un token par le serveur (fonction token-meta → pump.fun IPFS) : aucune clé à fournir.
declare global { interface Window { TSUploadMeta?: (fd: FormData) => Promise<string> } }
export function installTokenMeta() {
  window.TSUploadMeta = async (fd) => {
    const { data, error } = await supabase.functions.invoke('token-meta', { body: fd });
    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) { try { msg = (await error.context.json()).error || msg; } catch { /* réponse non JSON */ } }
      throw new Error(msg);
    }
    const uri = (data as { metadataUri?: string } | null)?.metadataUri;
    if (!uri) throw new Error('Réponse inattendue du serveur.');
    return uri;
  };
}

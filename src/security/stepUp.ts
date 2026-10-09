import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * Appels aux fonctions serveur avec confirmation renforcée : si le serveur répond 428 (« step_up »),
 * la fenêtre de confirmation s'ouvre (code par e-mail ou double authentification), puis l'appel recommence une fois.
 */
export type StepUpPurpose = 'withdraw' | 'limits_up' | 'export_key' | 'delete_wallet' | 'link_wallet' | 'delete_account';
export class FnError extends Error { constructor(msg: string, public status = 0, public code?: string, public data: Record<string, unknown> = {}) { super(msg); } }

async function invokeOnce<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message, status = 0, j: Record<string, unknown> = {};
    if (error instanceof FunctionsHttpError) {
      status = error.context.status;
      try { j = await error.context.json(); msg = (j.error as string) || msg; } catch { /* réponse non JSON */ }
    }
    throw new FnError(msg, status, j.code as string | undefined, j);
  }
  return data as T;
}

/* fenêtre de confirmation : ouverte par un événement, résolue quand l'utilisateur confirme ou annule */
type Ask = { purpose: StepUpPurpose; resolve: (ok: boolean) => void };
let pending: Ask | null = null;
const subs = new Set<(a: Ask | null) => void>();
export const stepUpStore = { get: () => pending, subscribe: (f: (a: Ask | null) => void) => { subs.add(f); return () => { subs.delete(f); }; } };
export function requestStepUp(purpose: StepUpPurpose): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { purpose, resolve: (ok) => { pending = null; subs.forEach((f) => f(null)); resolve(ok); } };
    subs.forEach((f) => f(pending));
  });
}

/** Appel d'une fonction serveur ; la confirmation renforcée est demandée si nécessaire */
export async function invokeSecure<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  try { return await invokeOnce<T>(fn, body); } catch (e) {
    if (!(e instanceof FnError) || e.status !== 428 || e.code !== 'step_up') throw e;
    const ok = await requestStepUp(e.data.purpose as StepUpPurpose);
    if (!ok) throw new FnError('Action annulée : elle n\'a pas été confirmée.', 0, 'cancelled');
    return invokeOnce<T>(fn, body);
  }
}

/** Fonction « security » (codes, appareils, sessions) */
export const security = <T>(action: string, body: Record<string, unknown> = {}) => invokeOnce<T>('security', { action, ...body });

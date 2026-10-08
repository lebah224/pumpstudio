import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

/**
 * Profil du compte connecté, partagé par le menu, la fenêtre de bienvenue et l'onglet Profil :
 * chargé une fois, mis à jour partout après chaque modification.
 */
let cur: Profile | null = null;
let uid: string | null = null;
const subs = new Set<(p: Profile | null) => void>();
const emit = () => subs.forEach((f) => f(cur));

export async function loadProfile(userId: string | null) {
  uid = userId;
  if (!userId) { cur = null; emit(); return null; }
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single<Profile>();
  if (uid !== userId) return null;
  cur = data ?? null; emit();
  return cur;
}

/** Modification du profil : renvoie l'erreur lisible, ou null */
export async function updateProfile(patch: Partial<Pick<Profile, 'username' | 'display_name' | 'avatar_url' | 'bio' | 'locale' | 'timezone'>>): Promise<string | null> {
  if (!uid) return 'Connexion requise.';
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', uid).select().single<Profile>();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return 'Ce nom d\'utilisateur est déjà pris.';
    if (/not_reserved/i.test(error.message)) return 'Ce nom d\'utilisateur est réservé.';
    if (/username/i.test(error.message)) return 'Nom d\'utilisateur : 3 à 24 lettres, chiffres ou _.';
    return error.message;
  }
  cur = data; emit();
  return null;
}

export function useProfile(): Profile | null {
  const [p, setP] = useState(cur);
  useEffect(() => { subs.add(setP); setP(cur); return () => { subs.delete(setP); }; }, []);
  return p;
}

/* ---------- nom d'utilisateur ---------- */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

/** Le nom d'utilisateur est-il libre ? (vérifié par le serveur : format, noms réservés, déjà pris) */
export async function usernameFree(u: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('username_available', { u });
  return error ? null : !!data;
}

/** Propositions de nom d'utilisateur à partir du nom affiché, de l'e-mail ou du wallet */
export function suggestUsernames(base: string): string[] {
  const clean = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/@.*$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 18) || 'trader';
  const root = clean.length >= 3 ? clean : clean + '_sol';
  const n = () => Math.floor(100 + Math.random() * 900);
  return [...new Set([root, root + '_' + n(), root.toLowerCase() + n()])].filter((x) => USERNAME_RE.test(x)).slice(0, 3);
}

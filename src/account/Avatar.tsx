import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

/* ---------- avatar généré : formes géométriques sur un dégradé, toujours le même pour un compte et un numéro ---------- */
const PALETTES = [
  ['#d6b26e', '#f0d49a', '#5a3d12', '#1b1407'], // or
  ['#6d8cf0', '#b7c6ff', '#1b2a66', '#0b1030'], // saphir
  ['#3ccf8e', '#a6f0cb', '#0f5136', '#06221a'], // jade
  ['#e08a5a', '#f6c3a1', '#6b2e12', '#2a1206'], // cuivre
  ['#a99bf0', '#ddd5ff', '#3d2f86', '#160f3a'], // iris
  ['#ef7a9a', '#ffc7d6', '#7a1d3a', '#2e0a17'], // rose
  ['#5cc8d6', '#bdeef4', '#0f5560', '#06262b'], // lagon
  ['#c9c4b8', '#f3efe6', '#4a463e', '#1a1916'], // platine
];
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let x = seed || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }

/** Avatar généré (SVG en data:) pour un compte et un numéro de variante */
export function generatedAvatar(userId: string, variant = 0): string {
  const r = rng(hash(userId + ':' + variant));
  const [a, b, c, d] = PALETTES[Math.floor(r() * PALETTES.length)]!;
  const ang = Math.floor(r() * 360), cx = 20 + r() * 40, cy = 20 + r() * 40, rad = 22 + r() * 16;
  const sx = 30 + r() * 30, sy = 34 + r() * 30, rot = Math.floor(r() * 90), sz = 26 + r() * 18;
  const dx = 18 + r() * 44, dy = 18 + r() * 44;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><linearGradient id="g" gradientTransform="rotate(${ang} .5 .5)"><stop offset="0" stop-color="${d}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>`
    + `<rect width="80" height="80" fill="url(#g)"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="${a}" opacity=".92"/>`
    + `<rect x="${(sx - sz / 2).toFixed(1)}" y="${(sy - sz / 2).toFixed(1)}" width="${sz.toFixed(1)}" height="${sz.toFixed(1)}" rx="6" fill="${b}" opacity=".78" transform="rotate(${rot} ${sx.toFixed(1)} ${sy.toFixed(1)})"/>`
    + `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="5" fill="${d}" opacity=".85"/></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/* ---------- avatar envoyé : image du stockage privé, lue par une adresse signée gardée en mémoire ---------- */
const signed = new Map<string, { url: string; exp: number }>();
async function signedUrl(path: string): Promise<string | null> {
  const hit = signed.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const key = path.replace(/^logos\//, '');
  const { data } = await supabase.storage.from('logos').createSignedUrl(key, 3600);
  if (!data?.signedUrl) return null;
  signed.set(path, { url: data.signedUrl, exp: Date.now() + 3300_000 });
  return data.signedUrl;
}

/** Adresse de l'image d'avatar d'un profil : envoyée, choisie parmi les générées, ou générée par défaut */
export function useAvatarSrc(p: Pick<Profile, 'id' | 'avatar_url'> | null): string | null {
  const gen = p ? generatedAvatar(p.id, /^gen:(\d+)$/.exec(p.avatar_url ?? '')?.[1] ? Number(/^gen:(\d+)$/.exec(p.avatar_url!)![1]) : 0) : null;
  const up = p?.avatar_url?.startsWith('logos/') ? p.avatar_url : null;
  const [src, setSrc] = useState<string | null>(() => (up ? signed.get(up)?.url ?? null : gen));
  useEffect(() => {
    if (!up) { setSrc(gen); return; }
    let alive = true;
    signedUrl(up).then((u) => { if (alive) setSrc(u ?? gen); });
    return () => { alive = false; };
  }, [up, gen]);
  return src;
}

/** Avatar rond du compte */
export function UserAvatar({ profile, size = 32, className = '' }: { profile: Pick<Profile, 'id' | 'avatar_url'> | null; size?: number; className?: string }) {
  const src = useAvatarSrc(profile);
  return (
    <span className={'ts-uav ' + className} style={{ width: size, height: size }} aria-hidden="true">
      {src && <img src={src} alt="" width={size} height={size} draggable={false} />}
    </span>
  );
}

/** Photo choisie par l'utilisateur : recadrée au centre, 256 px, WebP, envoyée dans son dossier du stockage */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Image PNG, JPEG, GIF ou WebP seulement.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Image trop lourde (8 Mo maximum).');
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height), N = 256;
  const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/webp', 0.86));
  if (!blob) throw new Error('Conversion de l\'image impossible.');
  const key = userId + '/avatar-' + Date.now() + '.webp';
  const { error } = await supabase.storage.from('logos').upload(key, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw new Error('Envoi impossible : ' + error.message);
  return 'logos/' + key;
}

/** Retire les anciennes photos d'avatar du stockage (garde celle en cours) */
export async function cleanAvatars(userId: string, keep: string | null) {
  const { data } = await supabase.storage.from('logos').list(userId, { limit: 100, search: 'avatar-' });
  const old = (data ?? []).map((f) => userId + '/' + f.name).filter((k) => 'logos/' + k !== keep && /\/avatar-\d+\.webp$/.test(k));
  if (old.length) await supabase.storage.from('logos').remove(old);
}

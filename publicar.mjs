// Publicador automático de Vantage UY (Instagram + Facebook).
// Lo ejecuta GitHub Actions cada 15 minutos. Lee cola.json, publica lo que ya llegó a su hora
// y anota en estado.json lo publicado para no repetirlo.
import fs from 'node:fs';

const CONFIG = {
  PAGES_BASE: 'https://vantagestoreuy.github.io/vantage-redes/',
  IG_USER_ID: '17841418137844041',
  FB_PAGE_ID: '1245054532026283',
  GRAPH: 'https://graph.facebook.com/v26.0',
  MAX_ATRASO_HORAS: 6,
  MAX_INTENTOS: 3,
  MAX_POR_CORRIDA: 3,
};
const TOKEN = process.env.META_TOKEN;
if (!TOKEN) {
  console.error('Falta el secreto META_TOKEN en el repo (Settings → Secrets and variables → Actions).');
  process.exit(1);
}

const estado = fs.existsSync('estado.json') ? JSON.parse(fs.readFileSync('estado.json', 'utf8')) : {};
estado.publicados ??= {};
estado.intentos ??= {};
estado.errores ??= {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (p) => (p.startsWith('http') ? p : CONFIG.PAGES_BASE + p.replace(/^\//, ''));

async function graph(method, path, params = {}) {
  const u = new URL(`${CONFIG.GRAPH}/${path}`);
  const opts = { method };
  if (method === 'GET') {
    for (const [k, v] of Object.entries({ ...params, access_token: TOKEN })) u.searchParams.set(k, v);
  } else {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify({ ...params, access_token: TOKEN });
  }
  const res = await fetch(u, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data;
}

// ---------- Instagram ----------
const igContainer = async (p) => (await graph('POST', `${CONFIG.IG_USER_ID}/media`, p)).id;
async function igWait(id) {
  for (let i = 0; i < 36; i++) {
    const r = await graph('GET', id, { fields: 'status_code' });
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new Error(`Instagram no pudo procesar el medio (${r.status_code})`);
    await sleep(10000);
  }
  throw new Error('Instagram tardó demasiado en procesar el medio');
}
async function igPublish(id) {
  await igWait(id);
  return (await graph('POST', `${CONFIG.IG_USER_ID}/media_publish`, { creation_id: id })).id;
}
async function publicarInstagram(p) {
  const m = p.medios.map(url);
  const caption = p.caption || '';
  if (p.tipo === 'story') return igPublish(await igContainer({ image_url: m[0], media_type: 'STORIES' }));
  if (p.tipo === 'imagen') return igPublish(await igContainer({ image_url: m[0], caption }));
  if (p.tipo === 'reel') return igPublish(await igContainer({ media_type: 'REELS', video_url: m[0], caption, share_to_feed: true }));
  if (p.tipo === 'carrusel') {
    const hijos = [];
    for (const x of m) {
      const id = await igContainer({ image_url: x, is_carousel_item: true });
      await igWait(id);
      hijos.push(id);
    }
    return igPublish(await igContainer({ media_type: 'CAROUSEL', children: hijos.join(','), caption }));
  }
  throw new Error('Tipo desconocido: ' + p.tipo);
}

// ---------- Facebook (página) ----------
async function publicarFacebook(p) {
  const m = p.medios.map(url);
  const message = p.caption || '';
  if (p.tipo === 'story') return 'omitido (las stories van solo a Instagram)';
  if (p.tipo === 'imagen') return (await graph('POST', `${CONFIG.FB_PAGE_ID}/photos`, { url: m[0], message })).id;
  if (p.tipo === 'reel') return (await graph('POST', `${CONFIG.FB_PAGE_ID}/videos`, { file_url: m[0], description: message })).id;
  if (p.tipo === 'carrusel') {
    const fotos = [];
    for (const x of m) fotos.push((await graph('POST', `${CONFIG.FB_PAGE_ID}/photos`, { url: x, published: false })).id);
    return (await graph('POST', `${CONFIG.FB_PAGE_ID}/feed`, { message, attached_media: fotos.map((id) => ({ media_fbid: id })) })).id;
  }
  throw new Error('Tipo desconocido: ' + p.tipo);
}

// ---------- Cola ----------
const cola = JSON.parse(fs.readFileSync('cola.json', 'utf8'));
const ahora = Date.now();
const pendientes = (cola.posts || [])
  .filter((p) => p.estado === 'aprobado')
  .filter((p) => {
    const t = Date.parse(p.fecha_hora);
    return t <= ahora && ahora - t < CONFIG.MAX_ATRASO_HORAS * 3600e3;
  })
  .sort((a, b) => Date.parse(a.fecha_hora) - Date.parse(b.fecha_hora));

let hechos = 0;
let fallos = 0;
for (const p of pendientes) {
  if (hechos >= CONFIG.MAX_POR_CORRIDA) break;
  for (const plat of p.plataformas || ['instagram']) {
    if (plat !== 'instagram' && plat !== 'facebook') continue; // TikTok se sube a mano
    const clave = `${p.id}:${plat}`;
    if (estado.publicados[clave] || (estado.intentos[clave] || 0) >= CONFIG.MAX_INTENTOS) continue;
    estado.intentos[clave] = (estado.intentos[clave] || 0) + 1;
    try {
      const id = plat === 'instagram' ? await publicarInstagram(p) : await publicarFacebook(p);
      estado.publicados[clave] = { id, cuando: new Date().toISOString() };
      delete estado.errores[clave];
      console.log(`OK  ${clave} → ${id}`);
      hechos++;
    } catch (e) {
      estado.errores[clave] = { error: e.message, intento: estado.intentos[clave], cuando: new Date().toISOString() };
      console.error(`ERROR ${clave} (intento ${estado.intentos[clave]}): ${e.message}`);
      fallos++;
    }
  }
}

// limpiar registros de más de 30 días
const limite = ahora - 30 * 864e5;
for (const k of ['publicados', 'errores']) {
  for (const [clave, v] of Object.entries(estado[k])) if (Date.parse(v.cuando) < limite) delete estado[k][clave];
}
fs.writeFileSync('estado.json', JSON.stringify(estado, null, 2) + '\n');
console.log(hechos || fallos ? `Publicados: ${hechos} · Errores: ${fallos}` : 'Nada para publicar ahora');
if (fallos) process.exitCode = 1; // marca la corrida en rojo para que se note

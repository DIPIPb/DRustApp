const { sql } = require('./db');

// Резервный источник картинки карты — используется, только если сам плагин
// не смог получить её через MapUploader (например, старая сборка сервера,
// где этого класса ещё нет). Нужен бесплатный ключ RustMaps.com в переменной
// окружения RUSTMAPS_API_KEY — без него функция просто вернёт null, и
// панель останется на сеточном режиме.

const RUSTMAPS_BASE = 'https://api.rustmaps.com/v4/maps';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchFromRustMaps(size, seed) {
  const apiKey = process.env.RUSTMAPS_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };
  if (!size || !seed) return { ok: false, error: 'missing_size_or_seed' };

  const url = `${RUSTMAPS_BASE}/${size}/${seed}`;
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

  try {
    await fetch(url, { method: 'POST', headers });

    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await fetch(url, { headers });
      if (!r.ok) return { ok: false, error: `rustmaps_http_${r.status}` };

      const json = await r.json();
      const data = json.data || json;

      if (data.status === 'completed' && (data.imageUrl || data.imageIconUrl)) {
        return { ok: true, imageUrl: data.imageUrl || data.imageIconUrl };
      }
      if (data.status === 'error' || data.status === 'failed') {
        return { ok: false, error: 'rustmaps_generation_failed' };
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return { ok: false, error: 'rustmaps_timeout' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Возвращает URL резервной картинки карты через RustMaps, используя
// кэш в БД (servers.fallback_map_image_url), если он не устарел.
async function getFallbackMapImageUrl(server) {
  if (!server.seed || !server.world_size) return null;

  const NON_PROCEDURAL_LEVELS = ['barren', 'hapis', 'savas island'];
  if (server.level && NON_PROCEDURAL_LEVELS.some(l => server.level.toLowerCase().includes(l))) {
    return null;
  }

  const cacheIsFresh = server.fallback_map_image_url &&
    server.fallback_map_image_fetched_at &&
    (Date.now() - new Date(server.fallback_map_image_fetched_at).getTime()) < CACHE_TTL_MS;

  if (cacheIsFresh) return server.fallback_map_image_url;

  const result = await fetchFromRustMaps(server.world_size, server.seed);
  if (!result.ok) return server.fallback_map_image_url || null;

  await sql`
    update servers set fallback_map_image_url = ${result.imageUrl}, fallback_map_image_fetched_at = now()
    where id = ${server.id}
  `;

  return result.imageUrl;
}

module.exports = { getFallbackMapImageUrl };

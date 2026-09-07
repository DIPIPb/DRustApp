const { sql } = require('./db');

// Интеграция с RustMaps.com — получаем реальную (спутниковую) картинку карты
// по seed + world_size, вместо абстрактной сетки.
//
// Нужен бесплатный API-ключ: зарегистрируйся на https://rustmaps.com,
// возьми ключ в личном кабинете и добавь его в Vercel как переменную
// окружения RUSTMAPS_API_KEY. Без ключа функция просто вернёт null,
// и панель останется на сеточном режиме карты (ничего не сломается).
//
// Как работает RustMaps API v4:
//  1) POST /v4/maps/{size}/{seed}  — запускает генерацию карты (или мгновенно
//     отдаёт готовую, если такая карта уже рендерилась раньше кем-то ещё).
//  2) GET  /v4/maps/{size}/{seed}  — проверяет статус; когда status === "completed",
//     в data.imageUrl лежит прямая ссылка на PNG.
// Генерация карты, которую никто раньше не рендерил, может занять от
// нескольких секунд до пары минут — поэтому мы кэшируем результат в БД
// (servers.map_image_url) и не дёргаем RustMaps на каждый запрос.

const RUSTMAPS_BASE = 'https://api.rustmaps.com/v4/maps';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24ч — на случай смены сида/вайпа

async function fetchFromRustMaps(size, seed) {
  const apiKey = process.env.RUSTMAPS_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };
  if (!size || !seed) return { ok: false, error: 'missing_size_or_seed' };

  const url = `${RUSTMAPS_BASE}/${size}/${seed}`;
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

  try {
    // Запускаем генерацию (идемпотентно — если карта уже есть, RustMaps
    // просто вернёт её статус).
    await fetch(url, { method: 'POST', headers });

    // Поллим статус до готовности, максимум ~40 секунд суммарно —
    // укладываемся в лимит выполнения serverless-функции Vercel.
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

      // ещё не готово — подождём и спросим снова
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return { ok: false, error: 'rustmaps_timeout' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Возвращает URL картинки карты для сервера, используя кэш в БД,
// если он не устарел; иначе запрашивает RustMaps и сохраняет результат.
async function getMapImageUrl(server) {
  if (!server.seed || !server.world_size) return null;

  // Barren (и другие спец-уровни без ландшафта) физически не рендерятся
  // на RustMaps.com — там нет уникального рельефа, который можно
  // сфотографировать. Не тратим время/лимит API на заведомо пустой запрос.
  const NON_PROCEDURAL_LEVELS = ['barren', 'hapis', 'savas island'];
  if (server.level && NON_PROCEDURAL_LEVELS.some(l => server.level.toLowerCase().includes(l))) {
    return null;
  }

  const cacheIsFresh = server.map_image_url &&
    server.map_image_fetched_at &&
    (Date.now() - new Date(server.map_image_fetched_at).getTime()) < CACHE_TTL_MS;

  if (cacheIsFresh) return server.map_image_url;

  const result = await fetchFromRustMaps(server.world_size, server.seed);
  if (!result.ok) return server.map_image_url || null; // отдаём старый кэш, если новый запрос не удался

  await sql`
    update servers set map_image_url = ${result.imageUrl}, map_image_fetched_at = now()
    where id = ${server.id}
  `;

  return result.imageUrl;
}

module.exports = { getMapImageUrl };

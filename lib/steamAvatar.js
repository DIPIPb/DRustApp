const { sql } = require('./db');

// Настоящие аватарки Steam через официальный Steam Web API.
// Нужен бесплатный ключ: https://steamcommunity.com/dev/apikey
// (для домена подойдёт любой, например "localhost" — ключ не привязан
// жёстко к домену для серверных запросов).
// Добавь его в Vercel как переменную окружения STEAM_API_KEY.
// Без ключа функция просто вернёт пустую мапу — в интерфейсе останутся
// аватарки-заглушки с первой буквой ника, ничего не сломается.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // сутки
const BATCH_SIZE = 100; // лимит Steam API за один запрос

async function fetchBatch(steamIds, apiKey) {
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamIds.join(',')}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const json = await r.json();
    return (json.response && json.response.players) || [];
  } catch {
    return [];
  }
}

// Возвращает мапу { steam_id: avatar_url } для списка SteamID64,
// используя кэш из БД и подтягивая недостающее/устаревшее из Steam Web API.
async function getAvatarsForSteamIds(steamIds) {
  const apiKey = process.env.STEAM_API_KEY;
  const uniqueIds = [...new Set(steamIds.filter(Boolean))];
  const result = {};
  if (!uniqueIds.length) return result;

  const { rows: cached } = await sql`
    select steam_id, avatar_url, avatar_fetched_at
    from players
    where steam_id = any(${uniqueIds}) and avatar_url is not null
  `;
  const cacheMap = new Map(cached.map(row => [row.steam_id, row]));
  const toFetch = [];

  for (const id of uniqueIds) {
    const row = cacheMap.get(id);
    const isFresh = row && row.avatar_fetched_at &&
      (Date.now() - new Date(row.avatar_fetched_at).getTime()) < CACHE_TTL_MS;
    if (isFresh) {
      result[id] = row.avatar_url;
    } else {
      toFetch.push(id);
    }
  }

  if (!toFetch.length || !apiKey) return result;

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const players = await fetchBatch(batch, apiKey);

    for (const p of players) {
      if (!p.steamid || !p.avatarfull) continue;
      result[p.steamid] = p.avatarfull;
      await sql`
        update players set avatar_url = ${p.avatarfull}, avatar_fetched_at = now()
        where steam_id = ${p.steamid}
      `;
    }
  }

  return result;
}

module.exports = { getAvatarsForSteamIds };

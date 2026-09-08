const { sql } = require('./db');

// Бесплатная гео-локация по IP через ip-api.com (без ключа, лимит ~45 запросов
// в минуту на IP-адрес сервера — Vercel это устраивает при нормальной нагрузке).
// Результаты кэшируем в БД на 30 дней, чтобы не долбить внешний сервис
// на каждый рендер вкладки "Игроки".

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isPrivateOrInvalid(ip) {
  if (!ip) return true;
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|0\.0\.0\.0|::1)/.test(ip);
}

async function fetchGeo(ip) {
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp`);
    if (!r.ok) return null;
    const data = await r.json();
    if (data.status !== 'success') return null;
    return {
      country: data.country || null,
      country_code: data.countryCode || null,
      city: data.city || null,
      isp: data.isp || null,
    };
  } catch {
    return null;
  }
}

// Возвращает мапу { ip: { country, country_code, city, isp } } для списка IP,
// используя кэш из БД и подтягивая недостающие/устаревшие с ip-api.com.
async function getGeoForIps(ips) {
  const uniqueIps = [...new Set(ips.filter(ip => !isPrivateOrInvalid(ip)))];
  const result = {};
  if (!uniqueIps.length) return result;

  const { rows: cached } = await sql`
    select ip, country, country_code, city, isp, fetched_at
    from ip_geo_cache
    where ip = any(${uniqueIps})
  `;

  const cacheMap = new Map(cached.map(row => [row.ip, row]));
  const toFetch = [];

  for (const ip of uniqueIps) {
    const row = cacheMap.get(ip);
    const isFresh = row && (Date.now() - new Date(row.fetched_at).getTime()) < CACHE_TTL_MS;
    if (isFresh) {
      result[ip] = { country: row.country, country_code: row.country_code, city: row.city, isp: row.isp };
    } else {
      toFetch.push(ip);
    }
  }

  // ip-api.com free tier не любит слишком частые параллельные запросы —
  // делаем небольшими последовательными пачками.
  for (const ip of toFetch) {
    const geo = await fetchGeo(ip);
    if (geo) {
      result[ip] = geo;
      await sql`
        insert into ip_geo_cache (ip, country, country_code, city, isp, fetched_at)
        values (${ip}, ${geo.country}, ${geo.country_code}, ${geo.city}, ${geo.isp}, now())
        on conflict (ip) do update set
          country = excluded.country, country_code = excluded.country_code,
          city = excluded.city, isp = excluded.isp, fetched_at = now()
      `;
    }
  }

  return result;
}

module.exports = { getGeoForIps };

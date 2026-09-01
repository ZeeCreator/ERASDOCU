import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';
import readline from 'readline';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { gotScraping as got } from 'got-scraping';

// ==========================================
// 📌 KONFIGURASI GLOBAL
// ==========================================
export const BASE_URL = 'https://x6.sokuja.uk';
export const AUTHOR_NAME = 'ZEROTZY.ID';

// Deteksi Vercel (filesystem read-only, hanya /tmp yang writable)
const IS_VERCEL = !!process.env.VERCEL;

const CONFIG = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  timeout: 30000,
  maxRetries: 5,
  retryDelay: 2000,
  rateLimitDelay: 3000,
  cookieFile: IS_VERCEL ? path.join('/tmp', 'cookies.json') : path.join(process.cwd(), 'cookies.json'),
  cacheDir: IS_VERCEL ? path.join('/tmp', '.cache') : path.join(process.cwd(), '.cache'),
  // Proxy untuk bypass IP block di Vercel (isi via ENV PROXY_URL / SOKUJA_PROXY)
  // Contoh: http://user:pass@proxy.example.com:8080 atau socks5://...
  proxyUrl: process.env.PROXY_URL || process.env.SOKUJA_PROXY || process.env.HTTPS_PROXY || null,
  cacheTTL: {
    home: 300000,
    search: 300000,
    anime: 600000,
    episode: 300000,
    schedule: 3600000,
    genres: 86400000,
    comments: 60000
  }
};

// Buat direktori cache (handle Vercel yang read-only)
try {
  if (!fs.existsSync(CONFIG.cacheDir)) {
    fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
  }
} catch (_) {}

// ==========================================
// 🍪 MANAJEMEN COOKIE - VERCEL READY
// ==========================================
// Cookie default yang lolos Cloudflare/Sokuja (dari user 2026-09-01)
export const DEFAULT_COOKIES = {
  "_ga": "GA1.1.64070199.1788269406",
  "_ga_4EKKHF0VF9": "GS2.1.s1788269405$o1$g1$t1788270151$j60$l0$h0$dO6V7TTjzhxoqlwHSrbIS6n0YeGgCdtZoYw",
  "c_ref_4736762": "https%3A%2F%2Fsokuja.id%2F",
  "HstCfa4736762": "1788269405250",
  "HstCla4736762": "1788269405250",
  "HstCmu4736762": "1788269405250",
  "HstCns4736762": "1",
  "HstCnv4736762": "1",
  "HstPn4736762": "1",
  "HstPt4736762": "1",
  "vid2": "f78eb90a-3fde-4344-b937-8741c1416939"
};

// Memory fallback untuk Vercel (karena /tmp bisa hilang tiap cold start)
let memoryCookies = { ...DEFAULT_COOKIES };

// Jika ada ENV var SOKUJA_COOKIES (format JSON string), merge
try {
  if (process.env.SOKUJA_COOKIES) {
    const envCookies = JSON.parse(process.env.SOKUJA_COOKIES);
    memoryCookies = { ...memoryCookies, ...envCookies };
    console.log('✅ Cookie loaded dari ENV SOKUJA_COOKIES');
  }
} catch (e) {
  console.warn('⚠️ Gagal parse SOKUJA_COOKIES env:', e.message);
}

export function loadCookies() {
  // Di Vercel, prioritaskan memory + file /tmp
  if (IS_VERCEL) {
    try {
      if (fs.existsSync(CONFIG.cookieFile)) {
        const fileCookies = JSON.parse(fs.readFileSync(CONFIG.cookieFile, 'utf8'));
        memoryCookies = { ...memoryCookies, ...fileCookies };
      }
    } catch (_) {}
    return { ...memoryCookies };
  }
  // Lokal: baca file + fallback ke default
  try {
    if (fs.existsSync(CONFIG.cookieFile)) {
      const fileCookies = JSON.parse(fs.readFileSync(CONFIG.cookieFile, 'utf8'));
      // Merge default + file (file menang)
      return { ...DEFAULT_COOKIES, ...fileCookies };
    }
  } catch (_) {}
  return { ...DEFAULT_COOKIES };
}

export function saveCookies(cookies) {
  // Selalu update memory
  memoryCookies = { ...memoryCookies, ...cookies };
  try {
    fs.writeFileSync(CONFIG.cookieFile, JSON.stringify(memoryCookies, null, 2));
  } catch (_) {
    // Di Vercel write bisa gagal, tapi memory sudah terupdate
  }
}

function buildCookieString(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function parseSetCookie(header) {
  const cookies = {};
  const parts = Array.isArray(header) ? header.join('; ') : header;
  if (!parts) return cookies;
  parts.split(';').forEach(p => {
    const [key, value] = p.trim().split('=');
    if (key && value && !['path', 'expires', 'domain', 'secure', 'httponly', 'samesite'].includes(key.toLowerCase())) {
      cookies[key] = value;
    }
  });
  return cookies;
}

// ==========================================
// 🌐 HTTP CLIENT DENGAN GOT-SCRAPING
// ==========================================
const HEADERS = {
  'User-Agent': CONFIG.userAgent,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0'
};

let cookiesReady = false;
// Init langsung dari DEFAULT_COOKIES biar di Vercel tidak perlu fetch
let cookieStringGlobal = buildCookieString(loadCookies());

// Inisialisasi cookie
async function initCookies() {
  if (cookiesReady) return;

  try {
    const saved = loadCookies();
    if (Object.keys(saved).length > 0) {
      cookieStringGlobal = buildCookieString(saved);
      console.log(`✅ Cookie loaded (${Object.keys(saved).length} cookies) - ${IS_VERCEL ? 'Vercel memory' : 'file'}`);
      cookiesReady = true;
      return;
    }

    console.log('🍪 Fetching initial cookie...');
    const response = await got.get(BASE_URL, {
      headers: {
        'User-Agent': CONFIG.userAgent,
        'Accept': HEADERS.Accept,
        'Accept-Language': HEADERS['Accept-Language'],
        'Accept-Encoding': HEADERS['Accept-Encoding'],
        'Connection': HEADERS.Connection
      },
      timeout: { request: CONFIG.timeout },
      https: { rejectUnauthorized: true },
      // Ikuti redirect
      followRedirect: true,
      // Simulasi browser dengan TLS fingerprint
      tls: {
        // Fingerprint mirip Chrome 124
        ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
        honorCipherOrder: true
      }
    });

    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const newCookies = parseSetCookie(setCookie);
      const current = loadCookies();
      saveCookies({ ...current, ...newCookies });
      cookieStringGlobal = buildCookieString({ ...current, ...newCookies });
      console.log('✅ Cookie berhasil diambil');
    } else {
      console.log('⚠️ No cookie received');
    }
    cookiesReady = true;
  } catch (err) {
    console.error('❌ Gagal init cookie:', err.message);
    cookiesReady = true;
  }
}

// Fungsi fetch utama dengan retry
export async function fetchWithRetry(url, options = {}, retries = CONFIG.maxRetries) {
  await initCookies();

  const target = url.startsWith('http') ? url : `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  const cookieString = cookieStringGlobal || buildCookieString(loadCookies());

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const reqHeaders = {
        ...HEADERS,
        ...options.headers,
        'Cookie': cookieString,
        'Referer': options.referer || `${BASE_URL}/`
      };

      // Rotasi User-Agent setiap percobaan
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      ];
      reqHeaders['User-Agent'] = userAgents[attempt % userAgents.length];

      const reqOptions = {
        headers: reqHeaders,
        timeout: { request: CONFIG.timeout },
        followRedirect: true,
        https: { rejectUnauthorized: true },
        // Proxy support untuk bypass IP block di Vercel
        ...(CONFIG.proxyUrl ? { proxyUrl: CONFIG.proxyUrl } : {}),
        // Retry otomatis untuk error tertentu
        retry: {
          limit: 2,
          statusCodes: [429, 500, 502, 503, 504],
          methods: ['GET', 'POST']
        }
      };

      if (options.body) {
        reqOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        reqOptions.headers['Content-Type'] = options.headers?.['Content-Type'] || 'application/json';
      }

      const response = await got.get(target, reqOptions);
      const body = response.body;

      // ======================================
      // 🛡️ DETEKSI & HANDLE CLOUDFLARE
      // ======================================
      const isChallenge = body.includes('cf-browser-verification') ||
                          body.includes('challenge-platform') ||
                          body.includes('__cf_chl') ||
                          body.includes('Just a moment') ||
                          body.includes('Checking your browser');

      if (isChallenge) {
        console.log(`⚠️ Cloudflare challenge (attempt ${attempt + 1}), waiting...`);
        await new Promise(r => setTimeout(r, CONFIG.retryDelay * (attempt + 2)));
        cookiesReady = false;
        await initCookies();
        continue;
      }

      // ======================================
      // 🚫 DETEKSI BLOKIR IP
      // ======================================
      if (body.includes('Anda dilarang mengakses') || body.includes('Dilarang mengakses')) {
        console.log(`🚫 IP diblokir (attempt ${attempt + 1})`);
        // Jika ada proxy, log bahwa proxy tidak membantu / belum di-set
        if (!CONFIG.proxyUrl) {
          console.log('💡 Tip: Set ENV PROXY_URL / SOKUJA_PROXY di Vercel untuk bypass IP block');
        }
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, CONFIG.retryDelay * (attempt + 1)));
          continue;
        }
        // Jangan throw 500 polos, kasih error yang bisa di-handle di API layer untuk fallback cache
        const err = new Error('IP_BLOCKED: Vercel IP diblokir Sokuja. Pasang proxy via ENV PROXY_URL / SOKUJA_PROXY (contoh: http://user:pass@proxy:port)');
        err.code = 'IP_BLOCKED';
        err.isBlocked = true;
        throw err;
      }

      // ======================================
      // ✅ SUKSES
      // ======================================
      if (response.statusCode >= 200 && response.statusCode < 300) {
        // Update cookie
        const sc = response.headers['set-cookie'];
        if (sc) {
          const newC = parseSetCookie(sc);
          const cur = loadCookies();
          saveCookies({ ...cur, ...newC });
          cookieStringGlobal = buildCookieString({ ...cur, ...newC });
        }
        return {
          ok: true,
          status: response.statusCode,
          text: async () => body,
          json: async () => {
            try { return JSON.parse(body); } catch { return {}; }
          },
          headers: response.headers
        };
      }

      // ======================================
      // ⚠️ ERROR STATUS
      // ======================================
      if (response.statusCode === 429) {
        const wait = CONFIG.rateLimitDelay * (attempt + 1);
        console.log(`⏳ Rate limit, wait ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (response.statusCode === 403 || response.statusCode === 401) {
        console.log('🔄 Cookie expired, refresh...');
        cookiesReady = false;
        await initCookies();
        continue;
      }

      throw new Error(`HTTP ${response.statusCode}`);

    } catch (err) {
      console.log(`❌ Attempt ${attempt + 1} error:`, err.message);
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, CONFIG.retryDelay * (attempt + 1)));
        cookiesReady = false;
        await initCookies();
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// Helper fetch HTML
async function fetchHtml(url, options = {}) {
  const res = await fetchWithRetry(url, options);
  return await res.text();
}

// ==========================================
// 🗂️ CACHE LAYER
// ==========================================
function getCacheKey(url) {
  return Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '_');
}

function getCache(key, ttl = 300000) {
  const filePath = path.join(CONFIG.cacheDir, key);
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs < ttl) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    }
  } catch (_) {}
  return null;
}

// Ambil cache stale (tanpa cek TTL) untuk fallback saat IP diblokir
function getCacheStale(key) {
  const filePath = path.join(CONFIG.cacheDir, key);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_) {}
  return null;
}

function setCache(key, data) {
  try {
    fs.writeFileSync(path.join(CONFIG.cacheDir, key), JSON.stringify(data));
  } catch (_) {}
}

function getCacheTTL(type) {
  return CONFIG.cacheTTL[type] || 300000;
}

// ==========================================
// 🛠️ HELPER FUNCTIONS
// ==========================================
export function formatResponse(data, message = 'Success') {
  return { status: 'success', author: AUTHOR_NAME, message, timestamp: new Date().toISOString(), data };
}

export function formatError(error, statusCode = 500) {
  // Jika IP diblokir, paksa status 403 biar jelas di client
  if (error?.isBlocked || error?.code === 'IP_BLOCKED' || String(error?.message||'').includes('IP_BLOCKED') || String(error?.message||'').includes('IP diblokir')) {
    statusCode = 403;
  } else if (error?.statusCode) {
    statusCode = error.statusCode;
  }
  return {
    status: 'error',
    author: AUTHOR_NAME,
    statusCode,
    message: typeof error === 'string' ? error : error?.message || 'Internal Server Error',
    hint: String(error?.message||'').includes('IP diblokir') ? 'Set ENV PROXY_URL / SOKUJA_PROXY di Vercel dengan proxy (contoh: http://user:pass@host:port) untuk bypass IP block Vercel' : undefined,
    timestamp: new Date().toISOString()
  };
}

function cleanImageUrl(img) {
  if (!img) return null;
  const match = img.match(/url=([^&]+)/);
  if (match) {
    const decoded = decodeURIComponent(match[1]);
    return decoded.startsWith('http') ? decoded : `${BASE_URL}${decoded.startsWith('/') ? '' : '/'}${decoded}`;
  }
  return img.startsWith('http') ? img : `${BASE_URL}${img.startsWith('/') ? '' : '/'}${img}`;
}

function extractRscPayload(html) {
  const chunks = html.split('self.__next_f.push([1,');
  let full = '';
  for (let i = 1; i < chunks.length; i++) {
    let c = chunks[i];
    const end = c.lastIndexOf('])');
    if (end !== -1) c = c.slice(0, end);
    try { full += JSON.parse(c); } catch (_) {}
  }
  return full;
}

function extractJsonLd(html) {
  const $ = cheerio.load(html);
  const results = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { results.push(JSON.parse($(el).html() || '{}')); } catch (_) {}
  });
  return results;
}

function isBlockedError(err) {
  return err?.isBlocked || err?.code === 'IP_BLOCKED' || String(err?.message||'').includes('IP diblokir') || String(err?.message||'').includes('IP_BLOCKED');
}

// ==========================================
// 🎯 CORE SCRAPER FUNCTIONS
// ==========================================

// 1. HOME
export async function getHome() {
  const key = 'home';
  const cached = getCache(key, getCacheTTL('home'));
  if (cached) return cached;

  let html;
  try {
    html = await fetchHtml('/');
  } catch (e) {
    if (isBlockedError(e)) {
      const stale = getCacheStale(key);
      if (stale) {
        console.log('⚠️ IP diblokir, return cache stale untuk home');
        return { ...stale, _stale: true, _blocked: true, message: stale.message + ' (stale - IP diblokir, pasang PROXY_URL)' };
      }
      e.statusCode = 403;
      throw e;
    }
    throw e;
  }
  const $ = cheerio.load(html);
  const rsc = extractRscPayload(html);

  const latest = [];
  const epRegex = /href":"\/([^"]+-episode-[^"]+)".*?"src":"([^"]+)","alt":"([^"]+)".*?children":\["EP ","([^"]+)"\]/g;
  let m;
  while ((m = epRegex.exec(rsc)) !== null) {
    const slug = m[1].replace(/^\/|\/$/g, '');
    if (!latest.some(e => e.slug === slug)) {
      latest.push({
        title: `${m[3].trim()} Episode ${m[4]}`,
        slug,
        episodeNumber: parseInt(m[4], 10),
        url: `${BASE_URL}/${slug}/`,
        thumbnail: cleanImageUrl(m[2])
      });
    }
  }

  let popular = [];
  const popMatch = rsc.match(/"weekly":\s*(\[[^\]]+\])/);
  if (popMatch) {
    try {
      popular = JSON.parse(popMatch[1]).map((item, idx) => ({
        rank: idx + 1,
        id: item.id,
        title: item.title,
        type: item.type || 'TV',
        status: item.status || 'Ongoing',
        year: item.year || null,
        score: item.score ? parseFloat(item.score) : null,
        views: item.viewCount || 0,
        slug: item.slug,
        url: `${BASE_URL}/anime/${item.slug}/`,
        thumbnail: cleanImageUrl(item.thumbnailUrl || item.coverUrl)
      }));
    } catch (_) {}
  }

  const seasons = [];
  $('aside button span.font-medium, a[href*="/season/"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && /^\d{4}$/.test(text)) {
      seasons.push({ year: parseInt(text, 10), url: `${BASE_URL}/season/${text}/` });
    }
  });

  const result = formatResponse({
    totalLatest: latest.length,
    latest: latest.slice(0, 18),
    popular: popular.slice(0, 10),
    seasons: seasons.slice(0, 10)
  }, 'Home data OK');

  setCache(key, result);
  return result;
}

// 2. SEARCH
export async function searchAnime(query) {
  if (!query) throw new Error('Query required');
  const key = `search_${query.toLowerCase().trim()}`;
  const cached = getCache(key, getCacheTTL('search'));
  if (cached) return cached;

  const res = await fetchWithRetry(`${BASE_URL}/api/search?q=${encodeURIComponent(query)}`);
  const json = await res.json();
  const results = (json.results || []).map(item => ({
    id: item.id,
    title: item.title,
    slug: item.slug,
    url: `${BASE_URL}/anime/${item.slug}/`,
    type: item.type || 'TV',
    status: item.status || 'Ongoing',
    year: item.year || null,
    score: item.score ? parseFloat(item.score) : null,
    views: item.viewCount || 0,
    thumbnail: cleanImageUrl(item.thumbnailUrl),
    cover: cleanImageUrl(item.coverUrl)
  }));

  const result = formatResponse({ query, total: results.length, results }, `Found ${results.length} results`);
  setCache(key, result);
  return result;
}

// 3. ANIME DETAIL
export async function getAnimeDetail(slug) {
  if (!slug) throw new Error('Slug required');
  const cleanSlug = slug.replace(/^\/anime\/|\/$/g, '');
  const key = `anime_${cleanSlug}`;
  const cached = getCache(key, getCacheTTL('anime'));
  if (cached) return cached;

  const html = await fetchHtml(`/anime/${cleanSlug}/`);
  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd(html);
  const meta = jsonLd.find(d => d['@type'] === 'TVSeries') || {};

  const title = $('h1').text().replace('Subtitle Indonesia', '').trim() || meta.name || cleanSlug;
  const altTitle = meta.alternateName || $('p.text-sm.text-gray-400').first().text().trim() || null;
  const score = meta.aggregateRating?.ratingValue || $('span.text-2xl.font-bold').first().text().trim() || null;
  const ratingCount = meta.aggregateRating?.ratingCount || null;
  const poster = meta.image || $('img[alt="' + title + '"]').attr('src') || $('img').eq(1).attr('src') || null;
  const synopsis = meta.description || $('div.prose p').text().trim() || null;
  const genres = meta.genre || $('a[href*="/genre/"]').map((_, el) => $(el).text().trim()).get();

  const info = {};
  $('dl div').each((_, el) => {
    const key = $(el).find('dt').text().trim().toLowerCase();
    const val = $(el).find('dd').text().trim();
    if (key && val) info[key] = val;
  });

  const cast = [];
  $('a[href*="/cast/"]').each((_, el) => {
    const name = $(el).text().trim();
    const slug = $(el).attr('href')?.replace(/^\/cast\/|\/$/g, '');
    if (name && slug && !cast.some(c => c.slug === slug)) {
      cast.push({ name, slug, url: `${BASE_URL}/cast/${slug}/` });
    }
  });

  const episodes = [];
  $('a[href*="-episode-"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const epSlug = href.replace(/^\/|\/$/g, '');
    const epTitle = $el.find('span').first().text().trim() || $el.text().trim();
    const epTime = $el.find('span.text-xs').text().trim() || 'Tersedia';
    if (epSlug && !episodes.some(ep => ep.slug === epSlug)) {
      const numMatch = epSlug.match(/episode-(\d+)/i) || epTitle.match(/episode\s*(\d+)/i);
      episodes.push({
        number: numMatch ? parseInt(numMatch[1], 10) : episodes.length + 1,
        title: epTitle,
        slug: epSlug,
        url: `${BASE_URL}/${epSlug}/`,
        released: epTime
      });
    }
  });
  episodes.sort((a, b) => a.number - b.number);

  const result = formatResponse({
    title,
    altTitle,
    slug: cleanSlug,
    url: `${BASE_URL}/anime/${cleanSlug}/`,
    poster: cleanImageUrl(poster),
    score: score ? parseFloat(score) : null,
    ratingCount,
    status: info['status'] || 'Ongoing',
    type: info['tipe'] || 'TV',
    year: info['tahun'] || null,
    season: info['musim'] || null,
    studio: info['studio'] || null,
    director: info['sutradara'] || null,
    producer: info['produser'] || null,
    fansub: info['fansub'] || 'SOKUJA.NET',
    genres: [...new Set(genres)],
    synopsis,
    cast,
    totalEpisodes: episodes.length,
    episodes: episodes.slice(0, 50)
  }, `Detail anime '${title}' OK`);

  setCache(key, result);
  return result;
}

// 4. EPISODE DETAIL + STREAMS
export async function getEpisodeDetail(slug) {
  if (!slug) throw new Error('Slug required');
  const cleanSlug = slug.replace(/^\/|\/$/g, '');
  const key = `episode_${cleanSlug}`;
  const cached = getCache(key, getCacheTTL('episode'));
  if (cached) return cached;

  const html = await fetchHtml(`/${cleanSlug}/`);
  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd(html);
  const meta = jsonLd.find(d => d['@type'] === 'TVEpisode') || {};

  const title = $('h1').text().replace('Subtitle Indonesia', '').trim() || meta.name || cleanSlug;
  const animeTitle = meta.partOfSeries?.name || $('nav a[href*="/anime/"]').text().trim() || null;
  const animeUrl = meta.partOfSeries?.url || $('nav a[href*="/anime/"]').attr('href') || null;
  const animeSlug = animeUrl ? animeUrl.replace(/.*\/anime\/|\/$/g, '') : null;
  const uploadDate = meta.uploadDate || $('span:contains("202")').first().text().trim() || null;
  const views = meta.interactionStatistic?.userInteractionCount || $('span:contains("views")').text().trim() || null;
  const thumbnail = meta.thumbnailUrl || $('img[fetchpriority="high"]').attr('src') || null;

  const epIdMatch = html.match(/episodeId[^\d]{1,10}(\d+)/i);
  const episodeId = epIdMatch ? parseInt(epIdMatch[1], 10) : null;

  // Stream mirrors
  let mirrors = [];
  const sources = [];

  if (episodeId) {
    try {
      const mr = await fetchWithRetry(`${BASE_URL}/api/video-mirrors?e=${episodeId}`, {
        headers: { 'Referer': `${BASE_URL}/${cleanSlug}/`, 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (mr.ok) {
        const data = await mr.json();
        (data.mirrors || []).forEach(m => {
          sources.push({
            id: m.id,
            server: m.serverName || 'SOKUJA',
            quality: m.quality || 'auto',
            type: m.embedType || 'hls',
            url: m.embedUrl,
            source: 'api'
          });
        });
      }
    } catch (_) {}
  }

  // Fallback scrape from HTML
  if (sources.length === 0) {
    const scraped = await scrapeStreamsFromHtml(html);
    sources.push(...scraped);
  }

  // Deduplicate
  const seen = new Set();
  mirrors = sources.filter(s => {
    if (!s.url) return false;
    const key = s.url.split('?')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Download links
  const downloads = [];
  $('a[href*="sokuja.id/x.php"], a:contains("Download")').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const quality = $el.find('span').text().trim() || $el.text().trim();
    if (href && (href.includes('x.php') || href.includes('http'))) {
      downloads.push({ quality: quality.replace(/Download/i, '').trim() || 'Default', link: href });
    }
  });

  const prevSlug = $('a:contains("Episode Sebelumnya")').attr('href')?.replace(/^\/|\/$/g, '') || null;
  const nextSlug = $('a:contains("Episode Selanjutnya")').attr('href')?.replace(/^\/|\/$/g, '') || null;

  const result = formatResponse({
    title,
    slug: cleanSlug,
    episodeId,
    anime: { title: animeTitle, slug: animeSlug, url: animeSlug ? `${BASE_URL}/anime/${animeSlug}/` : null },
    thumbnail: cleanImageUrl(thumbnail),
    uploadDate,
    views: typeof views === 'number' ? views : (views ? parseInt(views.replace(/\D/g, '')) || null : null),
    navigation: {
      prev: prevSlug ? { slug: prevSlug, url: `${BASE_URL}/${prevSlug}/` } : null,
      next: nextSlug ? { slug: nextSlug, url: `${BASE_URL}/${nextSlug}/` } : null,
      allEpisodes: animeSlug ? `${BASE_URL}/anime/${animeSlug}/` : null
    },
    mirrors,
    downloads
  }, `Episode '${title}' OK`);

  setCache(key, result);
  return result;
}

async function scrapeStreamsFromHtml(html) {
  const $ = cheerio.load(html);
  const streams = [];
  const patterns = [
    /"url"\s*:\s*"([^"]+\.(m3u8|mp4)[^"]*)"/gi,
    /"file"\s*:\s*"([^"]+\.(m3u8|mp4)[^"]*)"/gi,
    /"src"\s*:\s*"([^"]+\.(m3u8|mp4)[^"]*)"/gi,
    /source\s*:\s*["']([^"']+\.(m3u8|mp4)[^"']*)["']/gi,
    /video\s*:\s*["']([^"']+\.(m3u8|mp4)[^"']*)["']/gi,
    /https?:\/\/[^\s"']+\.(m3u8|mp4)/gi
  ];

  $('script').each((_, el) => {
    const content = $(el).html() || '';
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const url = match[1] || match[0];
        if (url && url.startsWith('http') && !url.includes('google')) {
          streams.push({
            url,
            quality: url.includes('1080') ? '1080p' : url.includes('720') ? '720p' : url.includes('480') ? '480p' : 'auto',
            type: url.includes('.m3u8') ? 'hls' : 'mp4',
            server: 'Scraped',
            source: 'html'
          });
        }
      }
    });
  });
  return streams;
}

// 5. ANIME LIST MODE
export async function getAnimeListMode() {
  const key = 'listmode';
  const cached = getCache(key, getCacheTTL('anime'));
  if (cached) return cached;

  const html = await fetchHtml('/anime/list-mode/');
  const $ = cheerio.load(html);
  const catalog = {};

  $('div.space-y-6 > div, div[id]').each((_, section) => {
    const letter = $(section).find('h2, span.text-xl, div.font-bold').first().text().trim() || '#';
    const items = [];
    $(section).find('a[href*="/anime/"]').each((_, a) => {
      const $a = $(a);
      const title = $a.text().trim();
      const href = $a.attr('href') || '';
      const slug = href.replace(/^\/anime\/|\/$/g, '');
      if (slug && title) items.push({ title, slug, url: `${BASE_URL}/anime/${slug}/` });
    });
    if (items.length > 0) catalog[letter] = items;
  });

  const result = formatResponse({ alphabet: Object.keys(catalog), catalog }, 'A-Z OK');
  setCache(key, result);
  return result;
}

// 6. FILTER ANIME
export async function getAnimeFilter({ status = 'ongoing', type = '', order = 'update', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  if (order) params.set('order', order);
  if (page > 1) params.set('page', String(page));

  const url = `/anime/?${params.toString()}`;
  const key = `filter_${params.toString()}`;
  const cached = getCache(key, getCacheTTL('anime'));
  if (cached) return cached;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const list = [];

  $('main a[href*="/anime/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    if (href === '/anime/' || href === '/anime/list-mode/') return;
    const slug = href.replace(/^\/anime\/|\/$/g, '');
    const title = $el.find('p, h3, div.text-sm').first().text().trim() || $el.attr('title') || '';
    const img = $el.find('img').attr('src') || $el.find('img').attr('srcset') || '';
    const typeTag = $el.find('span:contains("TV"), span:contains("Movie")').text().trim() || 'TV';
    if (slug && title && !list.some(a => a.slug === slug)) {
      list.push({ title, slug, url: `${BASE_URL}/anime/${slug}/`, type: typeTag, thumbnail: cleanImageUrl(img) });
    }
  });

  const result = formatResponse({ filters: { status, type, order, page: parseInt(page, 10) }, total: list.length, list }, 'Filter OK');
  setCache(key, result);
  return result;
}

// 7. SCHEDULE
export async function getSchedule() {
  const key = 'schedule';
  const cached = getCache(key, getCacheTTL('schedule'));
  if (cached) return cached;

  const html = await fetchHtml('/jadwal-rilis-anime/');
  const $ = cheerio.load(html);
  const schedule = {};
  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu', 'Random / Belum Pasti', 'Libur', 'Hiatus', 'Sudah Selesai (END)'];

  $('main h2').each((_, el) => {
    const day = $(el).text().trim();
    if (!days.includes(day)) return;
    const container = $(el).parent().parent();
    const animes = [];
    container.find('a[href*="/anime/"]').each((_, a) => {
      const $a = $(a);
      const href = $a.attr('href') || '';
      const slug = href.replace(/^\/anime\/|\/$/g, '');
      const title = $a.find('h3').text().trim() || $a.text().replace(/\d{2}:\d{2}\s*WIB/i, '').replace(/TV|Movie/i, '').trim();
      const img = $a.find('img').attr('src') || '';
      const timeMatch = $a.text().match(/(\d{2}:\d{2}\s*WIB)/i);
      const time = timeMatch ? timeMatch[1] : ($a.find('span.text-primary').text().trim() || 'TBA');
      if (slug && title && !animes.some(item => item.slug === slug)) {
        animes.push({ title, slug, url: `${BASE_URL}/anime/${slug}/`, time, thumbnail: cleanImageUrl(img) });
      }
    });
    if (animes.length > 0) schedule[day] = animes;
  });

  const result = formatResponse({ schedule }, 'Schedule OK');
  setCache(key, result);
  return result;
}

// 8. GENRES
export async function getGenres() {
  const key = 'genres';
  const cached = getCache(key, getCacheTTL('genres'));
  if (cached) return cached;

  const html = await fetchHtml('/genre/');
  const $ = cheerio.load(html);
  const genres = [];

  $('main a[href*="/genre/"], footer a[href*="/genre/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const slug = href.replace(/^\/genre\/|\/$/g, '');
    const name = $el.text().trim();
    if (slug && name && !genres.some(g => g.slug === slug)) {
      genres.push({ name, slug, url: `${BASE_URL}/genre/${slug}/` });
    }
  });

  const result = formatResponse({ total: genres.length, genres }, 'Genres OK');
  setCache(key, result);
  return result;
}

export async function getAnimeByGenre(genreSlug, page = 1) {
  if (!genreSlug) throw new Error('Genre slug required');
  const cleanSlug = genreSlug.replace(/^\/genre\/|\/$/g, '');
  const key = `genre_${cleanSlug}_${page}`;
  const cached = getCache(key, getCacheTTL('anime'));
  if (cached) return cached;

  const url = page > 1 ? `/genre/${cleanSlug}/?page=${page}` : `/genre/${cleanSlug}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const list = [];

  $('main a[href*="/anime/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    if (href === '/anime/' || href === '/anime/list-mode/') return;
    const slug = href.replace(/^\/anime\/|\/$/g, '');
    const title = $el.find('p, h3, div.text-sm').first().text().trim() || $el.text().trim();
    const img = $el.find('img').attr('src') || '';
    const typeTag = $el.find('span:contains("TV"), span:contains("Movie")').text().trim() || 'TV';
    if (slug && title && !list.some(a => a.slug === slug)) {
      list.push({ title, slug, url: `${BASE_URL}/anime/${slug}/`, type: typeTag, thumbnail: cleanImageUrl(img) });
    }
  });

  const result = formatResponse({ genre: cleanSlug, page: parseInt(page, 10), total: list.length, list }, 'Genre OK');
  setCache(key, result);
  return result;
}

// 9. COMMENTS
export async function getComments({ episodeId, animeId, limit = 10, cursor = null } = {}) {
  const params = new URLSearchParams();
  if (episodeId) params.set('episodeId', String(episodeId));
  if (animeId) params.set('animeId', String(animeId));
  if (limit) params.set('limit', String(Math.min(limit, 50)));
  if (cursor) params.set('cursor', String(cursor));

  const url = `${BASE_URL}/api/comments?${params.toString()}`;
  const key = `comments_${params.toString()}`;
  const cached = getCache(key, getCacheTTL('comments'));
  if (cached) return cached;

  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    const result = formatResponse(data, 'Comments OK');
    setCache(key, result);
    return result;
  } catch (error) {
    return formatResponse({ comments: [], pagination: { nextCursor: null, hasMore: false, total: 0 } }, 'Comments unavailable');
  }
}

// ==========================================
// 🚀 START SERVER (CLI)
// ==========================================
export function startServer(port = 3000) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    console.log(`📡 ${req.method} ${req.originalUrl}`);
    next();
  });

  app.get('/', (req, res) => {
    res.json(formatResponse({
      name: 'SOKUJA Scraper API',
      creator: AUTHOR_NAME,
      version: '3.1.0',
      routes: {
        home: 'GET /api/home',
        latest: 'GET /api/latest',
        popular: 'GET /api/popular',
        search: 'GET /api/search?q=:query',
        animeFilter: 'GET /api/anime?status=ongoing&type=tv&order=update&page=1',
        animeListMode: 'GET /api/anime/list-mode',
        animeDetail: 'GET /api/anime/:slug',
        episodeDetail: 'GET /api/episode/:slug',
        stream: 'GET /api/stream/:episodeId',
        schedule: 'GET /api/schedule',
        genres: 'GET /api/genres',
        genreAnime: 'GET /api/genres/:slug?page=1',
        comments: 'GET /api/comments?episodeId=:id&limit=10',
        cookie: 'POST /api/cookie',
        cache: 'DELETE /api/cache'
      }
    }, 'API running'));
  });

  // Semua endpoint API
  app.get('/api/home', async (req, res) => {
    try { res.json(await getHome()); } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.get('/api/latest', async (req, res) => {
    try {
      const home = await getHome();
      res.json(formatResponse({ total: home.data?.latest?.length || 0, latest: home.data?.latest || [] }, 'Latest OK'));
    } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.get('/api/popular', async (req, res) => {
    try {
      const home = await getHome();
      res.json(formatResponse({ total: home.data?.popular?.length || 0, popular: home.data?.popular || [] }, 'Popular OK'));
    } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.get('/api/search', async (req, res) => {
    try {
      const q = req.query.q || req.query.query;
      if (!q?.trim()) return res.status(400).json(formatError('Query "q" required', 400));
      res.json(await searchAnime(q.trim()));
    } catch (e) { res.status(400).json(formatError(e, 400)); }
  });

  app.get('/api/anime/list-mode', async (req, res) => {
    try { res.json(await getAnimeListMode()); } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.get('/api/anime/:slug', async (req, res) => {
    try {
      const slug = req.params.slug?.trim();
      if (!slug) return res.status(400).json(formatError('Slug required', 400));
      res.json(await getAnimeDetail(slug));
    } catch (e) { res.status(404).json(formatError(e, 404)); }
  });

  app.get('/api/anime', async (req, res) => {
    try {
      const { status, type, order, page } = req.query;
      res.json(await getAnimeFilter({ status, type, order, page }));
    } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.get('/api/episode/:slug', async (req, res) => {
    try {
      const slug = req.params.slug?.trim();
      if (!slug) return res.status(400).json(formatError('Slug required', 400));
      res.json(await getEpisodeDetail(slug));
    } catch (e) { res.status(404).json(formatError(e, 404)); }
  });

  app.get('/api/stream/:episodeId', async (req, res) => {
    try {
      const id = req.params.episodeId;
      if (!id) return res.status(400).json(formatError('Episode ID required', 400));
      const mr = await fetchWithRetry(`${BASE_URL}/api/video-mirrors?e=${id}`, {
        headers: { 'Referer': BASE_URL + '/', 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (mr.ok) {
        const data = await mr.json();
        return res.json(formatResponse({ episodeId: id, mirrors: data.mirrors || [], source: 'api' }, 'Stream OK'));
      }
      res.json(formatResponse({ episodeId: id, mirrors: [], source: 'none' }, 'No streams'));
    } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.post('/api/cookie', (req, res) => {
    try {
      const { cookies } = req.body;
      if (!cookies || typeof cookies !== 'object') {
        return res.status(400).json(formatError('Cookies object required', 400));
      }
      const cur = loadCookies();
      saveCookies({ ...cur, ...cookies });
      cookieStringGlobal = buildCookieString({ ...cur, ...cookies });
      res.json(formatResponse({ saved: Object.keys(cookies), total: Object.keys(loadCookies()).length }, 'Cookie saved'));
    } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.get('/api/schedule', async (req, res) => {
    try { res.json(await getSchedule()); } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.get('/api/genres', async (req, res) => {
    try { res.json(await getGenres()); } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.get('/api/genres/:slug', async (req, res) => {
    try {
      const slug = req.params.slug?.trim();
      const page = req.query.page || 1;
      if (!slug) return res.status(400).json(formatError('Slug required', 400));
      res.json(await getAnimeByGenre(slug, page));
    } catch (e) { res.status(404).json(formatError(e, 404)); }
  });

  app.get('/api/comments', async (req, res) => {
    try {
      const { episodeId, animeId, limit, cursor } = req.query;
      res.json(await getComments({ episodeId, animeId, limit, cursor }));
    } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.delete('/api/cache', (req, res) => {
    try {
      const files = fs.readdirSync(CONFIG.cacheDir);
      files.forEach(f => fs.unlinkSync(path.join(CONFIG.cacheDir, f)));
      res.json(formatResponse({ cleared: files.length }, 'Cache cleared'));
    } catch (e) { res.status(500).json(formatError(e)); }
  });

  app.use((req, res) => res.status(404).json(formatError(`Not found: ${req.method} ${req.originalUrl}`, 404)));
  app.use((err, req, res, next) => res.status(500).json(formatError(err)));

  const server = app.listen(port, () => {
    console.log(`\n🚀 Server running on http://localhost:${port}`);
    console.log(`📁 Cache: ${CONFIG.cacheDir}`);
    console.log(`🍪 Cookie: ${CONFIG.cookieFile}`);
    console.log(`👤 ${AUTHOR_NAME}\n`);
  });
  return server;
}

// ==========================================
// 🎨 CLI INTERFACE
// ==========================================
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  coral: '\x1b[38;2;217;119;6m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  white: '\x1b[37m'
};

function renderBanner() {
  console.clear();
  console.log(`${C.coral}
╔═══════════════════════════════════════════════════════════╗
║   ███████  ██████  ██   ██ ██    ██  █████  ██████       ║
║   ██      ██    ██ ██  ██  ██    ██ ██   ██ ██   ██      ║
║   ███████ ██    ██ █████   ██    ██ ███████ ██████        ║
║        ██ ██    ██ ██  ██  ██    ██ ██   ██ ██   ██      ║
║   ███████  ██████  ██   ██  ██████  ██   ██ ██   ██      ║
║            S O K U J A   S C R A P E R  v3.1             ║
║                  by ${AUTHOR_NAME}                          ║
╚═══════════════════════════════════════════════════════════╝${C.reset}
  `);
}

function promptQuestion(rl, query) {
  return new Promise(resolve => rl.question(`${C.coral}❯${C.reset} ${query} `, resolve));
}

function printJson(data) {
  console.log(`\n${C.gray}─── Response ───────────────────────────────────────${C.reset}`);
  console.log(JSON.stringify(data, null, 2));
  console.log(`${C.gray}────────────────────────────────────────────────────${C.reset}\n`);
}

async function runCli() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let running = true;

  while (running) {
    renderBanner();
    console.log(` ${C.coral}[1]${C.reset} Home & Update Terbaru`);
    console.log(` ${C.coral}[2]${C.reset} Cari Anime`);
    console.log(` ${C.coral}[3]${C.reset} Detail Anime`);
    console.log(` ${C.coral}[4]${C.reset} Episode + Stream`);
    console.log(` ${C.coral}[5]${C.reset} Katalog A-Z`);
    console.log(` ${C.coral}[6]${C.reset} Filter Anime`);
    console.log(` ${C.coral}[7]${C.reset} Jadwal Rilis`);
    console.log(` ${C.coral}[8]${C.reset} Genre`);
    console.log(` ${C.coral}[9]${C.reset} Set Cookie`);
    console.log(` ${C.coral}[s]${C.reset} Start API Server`);
    console.log(` ${C.coral}[0]${C.reset} Exit\n`);

    const choice = await promptQuestion(rl, 'Pilih:');

    try {
      switch (choice) {
        case '1': {
          const res = await getHome();
          res.data?.latest?.slice(0, 15).forEach((item, i) => {
            console.log(` ${C.coral}[${i+1}]${C.reset} ${item.title}`);
          });
          const pick = await promptQuestion(rl, 'Pilih episode:');
          if (pick && !isNaN(pick) && res.data?.latest[parseInt(pick)-1]) {
            const ep = await getEpisodeDetail(res.data.latest[parseInt(pick)-1].slug);
            printJson(ep);
          } else printJson(res);
          break;
        }
        case '2': {
          const q = await promptQuestion(rl, 'Judul:');
          if (!q) break;
          const res = await searchAnime(q);
          res.data?.results?.forEach((item, i) => {
            console.log(` ${C.coral}[${i+1}]${C.reset} ${item.title} (${item.type})`);
          });
          const pick = await promptQuestion(rl, 'Pilih anime:');
          if (pick && !isNaN(pick) && res.data?.results[parseInt(pick)-1]) {
            const detail = await getAnimeDetail(res.data.results[parseInt(pick)-1].slug);
            detail.data?.episodes?.slice(0, 10).forEach((ep, i) => {
              console.log(` ${C.coral}[${i+1}]${C.reset} ${ep.title}`);
            });
            const epPick = await promptQuestion(rl, 'Pilih episode:');
            if (epPick && !isNaN(epPick) && detail.data?.episodes[parseInt(epPick)-1]) {
              const epData = await getEpisodeDetail(detail.data.episodes[parseInt(epPick)-1].slug);
              printJson(epData);
            } else printJson(detail);
          } else printJson(res);
          break;
        }
        case '3': {
          const slug = await promptQuestion(rl, 'Slug anime:');
          if (slug) printJson(await getAnimeDetail(slug));
          break;
        }
        case '4': {
          const slug = await promptQuestion(rl, 'Slug episode:');
          if (slug) printJson(await getEpisodeDetail(slug));
          break;
        }
        case '5': printJson(await getAnimeListMode()); break;
        case '6': {
          const status = await promptQuestion(rl, 'Status (ongoing/completed):') || 'ongoing';
          printJson(await getAnimeFilter({ status }));
          break;
        }
        case '7': printJson(await getSchedule()); break;
        case '8': printJson(await getGenres()); break;
        case '9': {
          const input = await promptQuestion(rl, 'Cookie string (key=val; key2=val2):');
          if (input) {
            const cookies = {};
            input.split(';').forEach(p => {
              const [k, v] = p.trim().split('=');
              if (k && v) cookies[k] = v;
            });
            const cur = loadCookies();
            saveCookies({ ...cur, ...cookies });
            cookieStringGlobal = buildCookieString({ ...cur, ...cookies });
            console.log(`${C.green}✔ Cookie saved (${Object.keys(cookies).length})`);
          }
          break;
        }
        case 's':
        case 'S': {
          const port = parseInt(await promptQuestion(rl, 'Port (3000):')) || 3000;
          startServer(port);
          console.log(`${C.green}✔ Server running on http://localhost:${port}${C.reset}`);
          console.log(`${C.dim}Press Ctrl+C to stop${C.reset}`);
          break;
        }
        case '0': running = false; rl.close(); process.exit(0); break;
        default: console.log(`${C.coral}Invalid choice${C.reset}`);
      }
    } catch (err) {
      printJson(formatError(err));
    }
    if (running) await promptQuestion(rl, '\n[Enter] to continue...');
  }
}

// ==========================================
// 🏁 ENTRY POINT
// ==========================================
const currentFile = fileURLToPath(import.meta.url);
const isDirect = process.argv[1] && (
  process.argv[1] === currentFile ||
  process.argv[1].replace(/\\/g, '/') === currentFile.replace(/\\/g, '/')
);

if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes('--server') || args.includes('-s') || args.includes('serve')) {
    const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || 3000);
    startServer(port);
  } else if (args.includes('--cache-clear')) {
    try {
      const files = fs.readdirSync(CONFIG.cacheDir);
      files.forEach(f => fs.unlinkSync(path.join(CONFIG.cacheDir, f)));
      console.log(`✅ Cache cleared (${files.length} files)`);
    } catch (_) {}
  } else {
    runCli();
  }
}

// ==========================================
// 📤 EXPORT
// ==========================================

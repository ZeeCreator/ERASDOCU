import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';
import readline from 'readline';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import cloudscraper from 'cloudscraper';

export const BASE_URL = 'https://x6.sokuja.uk';
export const AUTHOR_NAME = 'ZEROTZY.ID';

// ==========================================
// 🔧 KONFIGURASI
// ==========================================
const CONFIG = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
  rateLimitDelay: 2000,
  cookieFile: path.join(process.cwd(), 'cookies.json'),
  cacheDir: path.join(process.cwd(), '.cache')
};

// Pastikan direktori cache ada
if (!fs.existsSync(CONFIG.cacheDir)) {
  fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
}

// ==========================================
// 🍪 MANAJEMEN COOKIE
// ==========================================
export function loadCookies() {
  try {
    if (fs.existsSync(CONFIG.cookieFile)) {
      const data = fs.readFileSync(CONFIG.cookieFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (_) {}
  return {};
}

export function saveCookies(cookies) {
  try {
    fs.writeFileSync(CONFIG.cookieFile, JSON.stringify(cookies, null, 2));
  } catch (_) {}
}

function buildCookieString(cookies) {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

// ==========================================
// 🌐 HTTP CLIENT DENGAN CLOUDSCRAPER + RETRY
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

let cookiesInitialized = false;
let cookieStringCache = '';
// ==========================================
// 🌐 HTTP CLIENT DENGAN CLOUDSCRAPER + RETRY + PROXY
// ==========================================

let cookiesInitialized = false;
let cookieStringCache = '';

// Inisialisasi cookie dengan cloudscraper
async function initializeCookies() {
  if (cookiesInitialized) return;
  
  try {
    console.log('🍪 Mengambil cookie awal dari halaman utama...');
    
    const response = await cloudscraper.get({
      uri: BASE_URL,
      headers: {
        'User-Agent': CONFIG.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1'
      },
      timeout: CONFIG.timeout,
      gzip: true,
      resolveWithFullResponse: true,
      challenges: 'cloudflare', // Coba bypass Cloudflare
      followAllRedirects: true,
      jar: true // Simpan cookie otomatis
    });

    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const newCookies = parseSetCookie(setCookie);
      const current = loadCookies();
      saveCookies({ ...current, ...newCookies });
      cookieStringCache = buildCookieString({ ...current, ...newCookies });
      console.log('✅ Cookie berhasil diambil dari Cloudflare');
    } else {
      const saved = loadCookies();
      if (Object.keys(saved).length > 0) {
        cookieStringCache = buildCookieString(saved);
        console.log('✅ Menggunakan cookie dari file');
      } else {
        console.log('⚠️ Tidak ada cookie, request mungkin tetap ditolak');
      }
    }
    cookiesInitialized = true;
  } catch (err) {
    console.error('❌ Gagal ambil cookie:', err.message);
    const saved = loadCookies();
    if (Object.keys(saved).length > 0) {
      cookieStringCache = buildCookieString(saved);
    }
    cookiesInitialized = true;
  }
}

// Fungsi fetch utama dengan cloudscraper + fallback fetch
export async function fetchWithRetry(url, options = {}, retries = CONFIG.maxRetries) {
  await initializeCookies();

  const target = url.startsWith('http') ? url : `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  let lastError;
  let body = null;
  let response = null;

  const cookieString = cookieStringCache || buildCookieString(loadCookies());

  // Cek proxy dari environment
  const proxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || null;

  for (let i = 0; i < retries; i++) {
    try {
      const requestOptions = {
        uri: target,
        method: options.method || 'GET',
        headers: {
          ...HEADERS,
          ...options.headers,
          'Cookie': cookieString || options.headers?.Cookie || '',
          'Referer': options.referer || `${BASE_URL}/`,
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: CONFIG.timeout,
        gzip: true,
        resolveWithFullResponse: true,
        challenges: 'cloudflare', // Bypass Cloudflare
        followAllRedirects: true,
        jar: true, // Cookie jar otomatis
        agent: proxy ? new (await import('https-proxy-agent')).HttpsProxyAgent(proxy) : undefined
      };

      // Jika ada body (POST)
      if (options.body) {
        requestOptions.body = options.body;
        if (typeof options.body === 'object') {
          requestOptions.body = JSON.stringify(options.body);
          requestOptions.headers['Content-Type'] = 'application/json';
        }
      }

      response = await cloudscraper.get(requestOptions);
      body = response.body;

      // Jika sukses
      if (response.statusCode === 200 || response.statusCode === 201) {
        // Cek apakah ada Cloudflare challenge
        if (body.includes('cf-browser-verification') || 
            body.includes('challenge-platform') || 
            body.includes('__cf_chl') ||
            body.includes('Just a moment')) {
          console.log('⚠️ Cloudflare challenge detected, waiting and retry...');
          await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay * (i + 1) * 3));
          // Refresh cookie
          cookiesInitialized = false;
          await initializeCookies();
          continue;
        }

        // Cek pesan blokir kustom (seperti yang kita lihat)
        if (body.includes('Anda dilarang mengakses') || body.includes('Dilarang mengakses')) {
          console.log('🚫 IP diblokir oleh situs. Coba gunakan proxy atau VPN.');
          // Coba fallback dengan fetch biasa
          console.log('🔄 Mencoba fallback dengan fetch biasa...');
          try {
            const fallbackRes = await fetch(target, {
              headers: {
                ...HEADERS,
                'Cookie': cookieString,
                'Referer': BASE_URL + '/'
              }
            });
            if (fallbackRes.ok) {
              const fallbackBody = await fallbackRes.text();
              return {
                ok: true,
                status: 200,
                text: async () => fallbackBody,
                json: async () => JSON.parse(fallbackBody),
                headers: fallbackRes.headers
              };
            }
          } catch (fallbackErr) {
            console.log('❌ Fallback fetch juga gagal:', fallbackErr.message);
          }
          throw new Error('403 - IP diblokir oleh situs. Gunakan proxy atau VPN.');
        }

        return {
          ok: true,
          status: response.statusCode,
          text: async () => body,
          json: async () => JSON.parse(body),
          headers: response.headers
        };
      }

      // Handle error status
      if (response.statusCode === 429) {
        const waitTime = CONFIG.rateLimitDelay * (i + 1);
        console.log(`⏳ Rate limited, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (response.statusCode === 403 || response.statusCode === 401) {
        console.log('🔄 Cookie expired atau akses ditolak, refreshing...');
        cookiesInitialized = false;
        await initializeCookies();
        continue;
      }

      throw new Error(`HTTP ${response.statusCode}`);

    } catch (err) {
      lastError = err;
      console.log(`❌ Attempt ${i + 1} failed:`, err.message);
      
      if (i < retries - 1) {
        const delay = CONFIG.retryDelay * (i + 1) * 2;
        console.log(`⏳ Retry ${i + 1}/${retries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Refresh cookie sebelum retry
        cookiesInitialized = false;
        await initializeCookies();
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}
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

function getCache(url, maxAge = 3600000) {
  const key = getCacheKey(url);
  const filePath = path.join(CONFIG.cacheDir, key);
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs < maxAge) {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
      }
    }
  } catch (_) {}
  return null;
}

function setCache(url, data) {
  const key = getCacheKey(url);
  const filePath = path.join(CONFIG.cacheDir, key);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch (_) {}
}

// ==========================================
// 🛠️ HELPER FUNCTIONS
// ==========================================
export function formatResponse(data, message = 'Success') {
  return {
    status: 'success',
    author: AUTHOR_NAME,
    message,
    timestamp: new Date().toISOString(),
    data
  };
}

export function formatError(error, statusCode = 500) {
  return {
    status: 'error',
    author: AUTHOR_NAME,
    statusCode,
    message: typeof error === 'string' ? error : error?.message || 'Internal Server Error',
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
  let fullRsc = '';
  for (let i = 1; i < chunks.length; i++) {
    let c = chunks[i];
    const end = c.lastIndexOf('])');
    if (end !== -1) c = c.slice(0, end);
    try {
      fullRsc += JSON.parse(c);
    } catch (_) {}
  }
  return fullRsc;
}

function extractJsonLd(html) {
  const $ = cheerio.load(html);
  const results = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      results.push(data);
    } catch (_) {}
  });
  return results;
}

// ==========================================
// 🎯 CORE SCRAPER FUNCTIONS
// ==========================================

/**
 * 1. GET HOME
 */
export async function getHome() {
  const cacheKey = 'home';
  const cached = getCache(cacheKey, 300000);
  if (cached) return cached;

  const html = await fetchHtml('/');
  const $ = cheerio.load(html);
  const rsc = extractRscPayload(html);

  const latestUpdates = [];
  const epRegex = /href":"\/([^"]+-episode-[^"]+)".*?"src":"([^"]+)","alt":"([^"]+)".*?children":\["EP ","([^"]+)"\]/g;
  let m;
  while ((m = epRegex.exec(rsc)) !== null) {
    const slug = m[1].replace(/^\/|\/$/g, '');
    if (!latestUpdates.some(e => e.slug === slug)) {
      latestUpdates.push({
        title: `${m[3].trim()} Episode ${m[4]}`,
        slug,
        episodeNumber: parseInt(m[4], 10),
        url: `${BASE_URL}/${slug}/`,
        thumbnail: cleanImageUrl(m[2])
      });
    }
  }

  let popularAnime = [];
  const popMatch = rsc.match(/"weekly":\s*(\[[^\]]+\])/);
  if (popMatch) {
    try {
      const weekly = JSON.parse(popMatch[1]);
      popularAnime = weekly.map((item, idx) => ({
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

  const seasonArchives = [];
  $('aside button span.font-medium, a[href*="/season/"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && /^\d{4}$/.test(text)) {
      seasonArchives.push({
        year: parseInt(text, 10),
        url: `${BASE_URL}/season/${text}/`
      });
    }
  });

  const result = formatResponse({
    totalLatestUpdates: latestUpdates.length,
    latestUpdates: latestUpdates.slice(0, 18),
    popularAnime: popularAnime.slice(0, 10),
    seasonArchives: seasonArchives.slice(0, 10)
  }, 'Home data retrieved successfully');

  setCache(cacheKey, result);
  return result;
}

/**
 * 2. SEARCH ANIME
 */
export async function searchAnime(query) {
  if (!query) throw new Error('Search query parameter is required');
  
  const cacheKey = `search_${query.toLowerCase().trim()}`;
  const cached = getCache(cacheKey, 300000);
  if (cached) return cached;

  const targetUrl = `${BASE_URL}/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetchWithRetry(targetUrl);
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

  const result = formatResponse({
    query,
    total: results.length,
    results
  }, `Found ${results.length} anime matching '${query}'`);

  setCache(cacheKey, result);
  return result;
}

/**
 * 3. ANIME DETAIL & EPISODE LIST
 */
export async function getAnimeDetail(slug) {
  if (!slug) throw new Error('Anime slug is required');
  const cleanSlug = slug.replace(/^\/anime\/|\/$/g, '');
  
  const cacheKey = `anime_${cleanSlug}`;
  const cached = getCache(cacheKey, 600000);
  if (cached) return cached;

  const html = await fetchHtml(`/anime/${cleanSlug}/`);
  const $ = cheerio.load(html);
  
  const jsonLd = extractJsonLd(html);
  const metadata = jsonLd.find(d => d['@type'] === 'TVSeries') || {};

  const title = $('h1').text().replace('Subtitle Indonesia', '').trim() || metadata.name || cleanSlug;
  const altTitle = metadata.alternateName || $('p.text-sm.text-gray-400').first().text().trim() || null;
  const score = metadata.aggregateRating?.ratingValue || $('span.text-2xl.font-bold').first().text().trim() || null;
  const ratingCount = metadata.aggregateRating?.ratingCount || null;
  const rawPoster = metadata.image || $('img[alt="' + title + '"]').attr('src') || $('img').eq(1).attr('src') || null;
  const synopsis = metadata.description || $('div.prose p').text().trim() || null;
  const genres = metadata.genre || $('a[href*="/genre/"]').map((_, el) => $(el).text().trim()).get();

  const info = {};
  $('dl div').each((_, el) => {
    const key = $(el).find('dt').text().trim().toLowerCase();
    const val = $(el).find('dd').text().trim();
    if (key && val) info[key] = val;
  });

  const cast = [];
  $('a[href*="/cast/"]').each((_, el) => {
    const castName = $(el).text().trim();
    const castSlug = $(el).attr('href')?.replace(/^\/cast\/|\/$/g, '');
    if (castName && castSlug && !cast.some(c => c.slug === castSlug)) {
      cast.push({ name: castName, slug: castSlug, url: `${BASE_URL}/cast/${castSlug}/` });
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
      const epNumberMatch = epSlug.match(/episode-(\d+)/i) || epTitle.match(/episode\s*(\d+)/i);
      episodes.push({
        episodeNumber: epNumberMatch ? parseInt(epNumberMatch[1], 10) : episodes.length + 1,
        title: epTitle,
        slug: epSlug,
        url: `${BASE_URL}/${epSlug}/`,
        releasedTime: epTime
      });
    }
  });

  episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

  const result = formatResponse({
    title,
    alternateTitle: altTitle,
    slug: cleanSlug,
    url: `${BASE_URL}/anime/${cleanSlug}/`,
    poster: cleanImageUrl(rawPoster),
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
  }, `Detail anime '${title}' retrieved successfully`);

  setCache(cacheKey, result);
  return result;
}

/**
 * 4. EPISODE DETAIL & STREAM MIRRORS
 */
export async function getEpisodeDetail(slug) {
  if (!slug) throw new Error('Episode slug is required');
  const cleanSlug = slug.replace(/^\/|\/$/g, '');
  
  const cacheKey = `episode_${cleanSlug}`;
  const cached = getCache(cacheKey, 300000);
  if (cached) return cached;

  const html = await fetchHtml(`/${cleanSlug}/`);
  const $ = cheerio.load(html);
  
  const jsonLd = extractJsonLd(html);
  const metadata = jsonLd.find(d => d['@type'] === 'TVEpisode') || {};

  const title = $('h1').text().replace('Subtitle Indonesia', '').trim() || metadata.name || cleanSlug;
  const animeTitle = metadata.partOfSeries?.name || $('nav a[href*="/anime/"]').text().trim() || null;
  const animeUrl = metadata.partOfSeries?.url || $('nav a[href*="/anime/"]').attr('href') || null;
  const animeSlug = animeUrl ? animeUrl.replace(/.*\/anime\/|\/$/g, '') : null;
  const uploadDate = metadata.uploadDate || $('span:contains("202")').first().text().trim() || null;
  const views = metadata.interactionStatistic?.userInteractionCount || $('span:contains("views")').text().trim() || null;
  const rawThumbnail = metadata.thumbnailUrl || $('img[fetchpriority="high"]').attr('src') || null;

  const epIdMatch = html.match(/episodeId[^\d]{1,10}(\d+)/i);
  const episodeId = epIdMatch ? parseInt(epIdMatch[1], 10) : null;

  let streamMirrors = [];
  const streamSources = [];

  if (episodeId) {
    try {
      const mirrorRes = await fetchWithRetry(`${BASE_URL}/api/video-mirrors?e=${episodeId}`, {
        headers: {
          'Referer': `${BASE_URL}/${cleanSlug}/`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (mirrorRes.ok) {
        const mirrorData = await mirrorRes.json();
        const mirrors = mirrorData.mirrors || [];
        streamSources.push(...mirrors.map(m => ({
          id: m.id,
          server: m.serverName || 'SOKUJA',
          quality: m.quality || 'auto',
          type: m.embedType || 'hls',
          streamUrl: m.embedUrl,
          source: 'api'
        })));
      }
    } catch (_) {}
  }

  if (streamSources.length === 0) {
    const scrapedStreams = await scrapeStreamsFromHtml(html, episodeId);
    streamSources.push(...scrapedStreams);
  }

  if (streamSources.length === 0) {
    const scriptStreams = await extractStreamsFromScripts(html);
    streamSources.push(...scriptStreams);
  }

  if (streamSources.length === 0) {
    const playerStreams = await extractPlayerConfig(html);
    streamSources.push(...playerStreams);
  }

  const seenUrls = new Set();
  streamMirrors = streamSources.filter(s => {
    if (!s.streamUrl) return false;
    const key = s.streamUrl.split('?')[0];
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });

  const downloadLinks = [];
  $('a[href*="sokuja.id/x.php"], a:contains("Download")').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const quality = $el.find('span').text().trim() || $el.text().trim();
    if (href && (href.includes('x.php') || href.includes('http'))) {
      downloadLinks.push({
        quality: quality.replace(/Download/i, '').trim() || 'Default',
        link: href
      });
    }
  });

  const prevSlug = $('a:contains("Episode Sebelumnya")').attr('href')?.replace(/^\/|\/$/g, '') || null;
  const nextSlug = $('a:contains("Episode Selanjutnya")').attr('href')?.replace(/^\/|\/$/g, '') || null;

  const result = formatResponse({
    title,
    episodeSlug: cleanSlug,
    episodeId,
    anime: {
      title: animeTitle,
      slug: animeSlug,
      url: animeSlug ? `${BASE_URL}/anime/${animeSlug}/` : null
    },
    thumbnail: cleanImageUrl(rawThumbnail),
    uploadDate,
    views: typeof views === 'number' ? views : (views ? parseInt(views.replace(/\D/g, '')) || null : null),
    navigation: {
      prevEpisode: prevSlug ? { slug: prevSlug, url: `${BASE_URL}/${prevSlug}/` } : null,
      nextEpisode: nextSlug ? { slug: nextSlug, url: `${BASE_URL}/${nextSlug}/` } : null,
      allEpisodesUrl: animeSlug ? `${BASE_URL}/anime/${animeSlug}/` : null
    },
    streamMirrors,
    downloadLinks
  }, `Episode '${title}' data retrieved successfully`);

  setCache(cacheKey, result);
  return result;
}

async function scrapeStreamsFromHtml(html, episodeId) {
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
          const isM3u8 = url.includes('.m3u8');
          streams.push({
            streamUrl: url,
            quality: url.includes('1080') ? '1080p' : 
                    url.includes('720') ? '720p' : 
                    url.includes('480') ? '480p' : 
                    url.includes('360') ? '360p' : 'auto',
            type: isM3u8 ? 'hls' : 'mp4',
            server: 'Scraped',
            source: 'html'
          });
        }
      }
    });
  });

  return streams;
}

async function extractStreamsFromScripts(html) {
  const $ = cheerio.load(html);
  const streams = [];
  const rsc = extractRscPayload(html);

  const rscPatterns = [
    /"streamUrl":"([^"]+\.(m3u8|mp4)[^"]*)"/gi,
    /"embedUrl":"([^"]+\.(m3u8|mp4)[^"]*)"/gi,
    /"file":"([^"]+\.(m3u8|mp4)[^"]*)"/gi
  ];

  rscPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(rsc)) !== null) {
      const url = match[1];
      if (url && url.startsWith('http')) {
        streams.push({
          streamUrl: url,
          quality: 'auto',
          type: url.includes('.m3u8') ? 'hls' : 'mp4',
          server: 'RSC',
          source: 'rsc'
        });
      }
    }
  });

  return streams;
}

async function extractPlayerConfig(html) {
  const $ = cheerio.load(html);
  const streams = [];

  $('video, source').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src && src.startsWith('http')) {
      streams.push({
        streamUrl: src,
        quality: $(el).attr('data-quality') || 'auto',
        type: src.includes('.m3u8') ? 'hls' : 'mp4',
        server: 'VideoElement',
        source: 'video'
      });
    }
  });

  return streams;
}

/**
 * 5. ANIME LIST MODE
 */
export async function getAnimeListMode() {
  const cacheKey = 'listmode';
  const cached = getCache(cacheKey, 3600000);
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
      if (slug && title) {
        items.push({ title, slug, url: `${BASE_URL}/anime/${slug}/` });
      }
    });

    if (items.length > 0) {
      catalog[letter] = items;
    }
  });

  const result = formatResponse({
    alphabetIndex: Object.keys(catalog),
    catalog
  }, 'Anime A-Z list-mode retrieved successfully');

  setCache(cacheKey, result);
  return result;
}

/**
 * 6. FILTER ANIME
 */
export async function getAnimeFilter({ status = 'ongoing', type = '', order = 'update', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  if (order) params.set('order', order);
  if (page && page > 1) params.set('page', String(page));

  const url = `/anime/?${params.toString()}`;
  const cacheKey = `filter_${params.toString()}`;
  const cached = getCache(cacheKey, 300000);
  if (cached) return cached;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const animeList = [];
  $('main a[href*="/anime/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    if (href === '/anime/' || href === '/anime/list-mode/') return;

    const slug = href.replace(/^\/anime\/|\/$/g, '');
    const title = $el.find('p, h3, div.text-sm').first().text().trim() || $el.attr('title') || '';
    const rawImg = $el.find('img').attr('src') || $el.find('img').attr('srcset') || $el.find('img').attr('srcSet') || '';
    const typeTag = $el.find('span:contains("TV"), span:contains("Movie")').text().trim() || 'TV';

    if (slug && title && !animeList.some(a => a.slug === slug)) {
      animeList.push({
        title,
        slug,
        url: `${BASE_URL}/anime/${slug}/`,
        type: typeTag,
        thumbnail: cleanImageUrl(rawImg)
      });
    }
  });

  const result = formatResponse({
    filters: { status, type, order, page: parseInt(page, 10) },
    total: animeList.length,
    animeList
  }, `Filtered anime (page ${page}) retrieved successfully`);

  setCache(cacheKey, result);
  return result;
}

/**
 * 7. JADWAL RILIS
 */
export async function getSchedule() {
  const cacheKey = 'schedule';
  const cached = getCache(cacheKey, 3600000);
  if (cached) return cached;

  const html = await fetchHtml('/jadwal-rilis-anime/');
  const $ = cheerio.load(html);

  const schedule = {};
  const validDays = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu', 'Random / Belum Pasti', 'Libur', 'Hiatus', 'Sudah Selesai (END)'];

  $('main h2').each((_, el) => {
    const dayName = $(el).text().trim();
    if (!validDays.includes(dayName)) return;

    const container = $(el).parent().parent();
    const animes = [];

    container.find('a[href*="/anime/"]').each((_, a) => {
      const $a = $(a);
      const href = $a.attr('href') || '';
      const slug = href.replace(/^\/anime\/|\/$/g, '');
      const title = $a.find('h3').text().trim() || $a.text().replace(/\d{2}:\d{2}\s*WIB/i, '').replace(/TV|Movie/i, '').trim();
      const rawImg = $a.find('img').attr('src') || $a.find('img').attr('srcset') || $a.find('img').attr('srcSet') || '';
      const timeMatch = $a.text().match(/(\d{2}:\d{2}\s*WIB)/i);
      const airingTime = timeMatch ? timeMatch[1] : ($a.find('span.text-primary').text().trim() || 'TBA');

      if (slug && title && !animes.some(item => item.slug === slug)) {
        animes.push({
          title,
          slug,
          url: `${BASE_URL}/anime/${slug}/`,
          airingTime,
          thumbnail: cleanImageUrl(rawImg)
        });
      }
    });

    if (animes.length > 0) {
      schedule[dayName] = animes;
    }
  });

  const result = formatResponse({ schedule }, 'Release schedule retrieved successfully');
  setCache(cacheKey, result);
  return result;
}

/**
 * 8. GENRES
 */
export async function getGenres() {
  const cacheKey = 'genres';
  const cached = getCache(cacheKey, 86400000);
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
      genres.push({
        name,
        slug,
        url: `${BASE_URL}/genre/${slug}/`
      });
    }
  });

  const result = formatResponse({ total: genres.length, genres }, 'Genres list retrieved successfully');
  setCache(cacheKey, result);
  return result;
}

export async function getAnimeByGenre(genreSlug, page = 1) {
  if (!genreSlug) throw new Error('Genre slug is required');
  const cleanSlug = genreSlug.replace(/^\/genre\/|\/$/g, '');
  
  const cacheKey = `genre_${cleanSlug}_${page}`;
  const cached = getCache(cacheKey, 300000);
  if (cached) return cached;

  const url = page > 1 ? `/genre/${cleanSlug}/?page=${page}` : `/genre/${cleanSlug}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const animeList = [];
  $('main a[href*="/anime/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    if (href === '/anime/' || href === '/anime/list-mode/') return;

    const slug = href.replace(/^\/anime\/|\/$/g, '');
    const title = $el.find('p, h3, div.text-sm').first().text().trim() || $el.text().trim();
    const rawImg = $el.find('img').attr('src') || $el.find('img').attr('srcset') || $el.find('img').attr('srcSet') || '';
    const typeTag = $el.find('span:contains("TV"), span:contains("Movie")').text().trim() || 'TV';

    if (slug && title && !animeList.some(a => a.slug === slug)) {
      animeList.push({
        title,
        slug,
        url: `${BASE_URL}/anime/${slug}/`,
        type: typeTag,
        thumbnail: cleanImageUrl(rawImg)
      });
    }
  });

  const result = formatResponse({
    genre: cleanSlug,
    page: parseInt(page, 10),
    total: animeList.length,
    animeList
  }, `Anime for genre '${cleanSlug}' retrieved successfully`);

  setCache(cacheKey, result);
  return result;
}

/**
 * 9. GET COMMENTS
 */
export async function getComments({ episodeId, animeId, limit = 10, cursor = null } = {}) {
  const params = new URLSearchParams();
  if (episodeId) params.set('episodeId', String(episodeId));
  if (animeId) params.set('animeId', String(animeId));
  if (limit) params.set('limit', String(Math.min(limit, 50)));
  if (cursor) params.set('cursor', String(cursor));

  const url = `${BASE_URL}/api/comments?${params.toString()}`;
  const cacheKey = `comments_${params.toString()}`;
  const cached = getCache(cacheKey, 60000);
  if (cached) return cached;

  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    const result = formatResponse(data, 'Comments retrieved successfully');
    setCache(cacheKey, result);
    return result;
  } catch (error) {
    return formatResponse({
      comments: [],
      pagination: { nextCursor: null, hasMore: false, total: 0 },
      error: error.message
    }, 'Comments unavailable');
  }
}

// ==========================================
// 🚀 REST API SERVER
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
      name: 'SOKUJA REST API Scraper Service',
      creator: AUTHOR_NAME,
      version: '2.0.0',
      routes: {
        home: 'GET /api/home',
        latest: 'GET /api/latest',
        popular: 'GET /api/popular',
        search: 'GET /api/search?q=:query',
        animeFilter: 'GET /api/anime?status=ongoing&type=tv&order=update&page=1',
        animeListMode: 'GET /api/anime/list-mode',
        animeDetail: 'GET /api/anime/:slug',
        episodeDetail: 'GET /api/episode/:slug',
        episodeStream: 'GET /api/stream/:episodeId',
        schedule: 'GET /api/schedule',
        genres: 'GET /api/genres',
        genreAnime: 'GET /api/genres/:slug?page=1',
        comments: 'GET /api/comments?episodeId=:id&limit=10',
        cookie: 'POST /api/cookie (set cookie)'
      }
    }, 'SOKUJA REST API is running'));
  });

  app.get('/api/home', async (req, res) => {
    try {
      res.json(await getHome());
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.get('/api/latest', async (req, res) => {
    try {
      const home = await getHome();
      res.json(formatResponse({
        total: home.data?.latestUpdates?.length || 0,
        latestUpdates: home.data?.latestUpdates || []
      }, 'Latest episode updates retrieved'));
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.get('/api/popular', async (req, res) => {
    try {
      const home = await getHome();
      res.json(formatResponse({
        total: home.data?.popularAnime?.length || 0,
        popularAnime: home.data?.popularAnime || []
      }, 'Popular anime retrieved'));
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.get('/api/search', async (req, res) => {
    try {
      const q = req.query.q || req.query.query;
      if (!q || !q.trim()) {
        return res.status(400).json(formatError('Query parameter "q" or "query" is required', 400));
      }
      res.json(await searchAnime(q.trim()));
    } catch (err) {
      res.status(400).json(formatError(err, 400));
    }
  });

  app.get('/api/anime/list-mode', async (req, res) => {
    try {
      res.json(await getAnimeListMode());
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.get('/api/anime/:slug', async (req, res) => {
    try {
      const slug = req.params.slug?.trim();
      if (!slug) return res.status(400).json(formatError('Anime slug is required', 400));
      res.json(await getAnimeDetail(slug));
    } catch (err) {
      res.status(404).json(formatError(err, 404));
    }
  });

  app.get('/api/anime', async (req, res) => {
    try {
      const { status, type, order, page } = req.query;
      res.json(await getAnimeFilter({ status, type, order, page }));
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.get('/api/episode/:slug', async (req, res) => {
    try {
      const slug = req.params.slug?.trim();
      if (!slug) return res.status(400).json(formatError('Episode slug is required', 400));
      res.json(await getEpisodeDetail(slug));
    } catch (err) {
      res.status(404).json(formatError(err, 404));
    }
  });

  app.get('/api/stream/:episodeId', async (req, res) => {
    try {
      const episodeId = req.params.episodeId;
      if (!episodeId) {
        return res.status(400).json(formatError('Episode ID is required', 400));
      }

      const mirrorRes = await fetchWithRetry(`${BASE_URL}/api/video-mirrors?e=${episodeId}`, {
        headers: {
          'Referer': `${BASE_URL}/`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (mirrorRes.ok) {
        const data = await mirrorRes.json();
        return res.json(formatResponse({
          episodeId,
          mirrors: data.mirrors || [],
          source: 'api'
        }, 'Stream mirrors retrieved'));
      }

      res.json(formatResponse({
        episodeId,
        mirrors: [],
        source: 'none',
        message: 'No streams available'
      }, 'No streams found'));

    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.post('/api/cookie', (req, res) => {
    try {
      const { cookies } = req.body;
      if (!cookies || typeof cookies !== 'object') {
        return res.status(400).json(formatError('Cookies object is required', 400));
      }
      const current = loadCookies();
      saveCookies({ ...current, ...cookies });
      res.json(formatResponse({
        saved: Object.keys(cookies),
        total: Object.keys(loadCookies()).length
      }, 'Cookies saved successfully'));
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.get('/api/schedule', async (req, res) => {
    try {
      res.json(await getSchedule());
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.get('/api/genres', async (req, res) => {
    try {
      res.json(await getGenres());
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.get('/api/genres/:slug', async (req, res) => {
    try {
      const slug = req.params.slug?.trim();
      const page = req.query.page || 1;
      if (!slug) return res.status(400).json(formatError('Genre slug is required', 400));
      res.json(await getAnimeByGenre(slug, page));
    } catch (err) {
      res.status(404).json(formatError(err, 404));
    }
  });

  app.get('/api/comments', async (req, res) => {
    try {
      const { episodeId, animeId, limit, cursor } = req.query;
      res.json(await getComments({ episodeId, animeId, limit, cursor }));
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.delete('/api/cache', (req, res) => {
    try {
      const files = fs.readdirSync(CONFIG.cacheDir);
      for (const file of files) {
        fs.unlinkSync(path.join(CONFIG.cacheDir, file));
      }
      res.json(formatResponse({ cleared: files.length }, 'Cache cleared'));
    } catch (err) {
      res.status(500).json(formatError(err));
    }
  });

  app.use((req, res) => {
    res.status(404).json(formatError(`Endpoint '${req.method} ${req.originalUrl}' not found`, 404));
  });

  app.use((err, req, res, next) => {
    res.status(500).json(formatError(err?.message || 'Internal Server Error', 500));
  });

  const server = app.listen(port, () => {
    console.log(`\n🚀 SOKUJA REST API Server running on http://localhost:${port}`);
    console.log(`📁 Cache directory: ${CONFIG.cacheDir}`);
    console.log(`🍪 Cookie file: ${CONFIG.cookieFile}`);
    console.log(`👤 Creator: ${AUTHOR_NAME}\n`);
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
  white: '\x1b[37m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

function renderBanner() {
  console.clear();
  console.log(`${C.coral}
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ███████  ██████  ██   ██ ██    ██  █████  ██████       ║
║   ██      ██    ██ ██  ██  ██    ██ ██   ██ ██   ██      ║
║   ███████ ██    ██ █████   ██    ██ ███████ ██████        ║
║        ██ ██    ██ ██  ██  ██    ██ ██   ██ ██   ██      ║
║   ███████  ██████  ██   ██  ██████  ██   ██ ██   ██      ║
║                                                           ║
║            S O K U J A   S C R A P E R                   ║
║                  by ${AUTHOR_NAME}                          ║
╚═══════════════════════════════════════════════════════════╝${C.reset}
  `);
}

function promptQuestion(rl, query) {
  return new Promise(resolve => {
    rl.question(`${C.coral}❯${C.reset} ${query} `, answer => resolve(answer.trim()));
  });
}

function printJsonResult(data) {
  console.log(`\n${C.gray}─── ${C.coral}JSON Response${C.reset} ${C.gray}──────────────────────────────────────────────${C.reset}`);
  console.log(JSON.stringify(data, null, 2));
  console.log(`${C.gray}─────────────────────────────────────────────────────────────────${C.reset}\n`);
}

async function runCli() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let running = true;

  while (running) {
    renderBanner();
    console.log(`${C.bold}PILIH MENU UTAMA:${C.reset}\n`);
    console.log(` ${C.coral}[1]${C.reset} ⚡ ${C.white}Home & Update Terbaru${C.reset}`);
    console.log(` ${C.coral}[2]${C.reset} 🔍 ${C.white}Cari Anime & Stream${C.reset}`);
    console.log(` ${C.coral}[3]${C.reset} 📖 ${C.white}Detail Anime & Daftar Episode${C.reset}`);
    console.log(` ${C.coral}[4]${C.reset} 🎬 ${C.white}Stream Direct MP4 & Download${C.reset}`);
    console.log(` ${C.coral}[5]${C.reset} 🗂️ ${C.white}Anime List Mode (A-Z)${C.reset}`);
    console.log(` ${C.coral}[6]${C.reset} 🎛️ ${C.white}Filter Anime${C.reset}`);
    console.log(` ${C.coral}[7]${C.reset} 📅 ${C.white}Jadwal Rilis Anime${C.reset}`);
    console.log(` ${C.coral}[8]${C.reset} 🏷️ ${C.white}Daftar Genre${C.reset}`);
    console.log(` ${C.coral}[9]${C.reset} 🍪 ${C.white}Set Cookie (untuk akses lebih baik)${C.reset}`);
    console.log(` ${C.coral}[s]${C.reset} 🚀 ${C.white}Jalankan REST API Server${C.reset}`);
    console.log(` ${C.coral}[0]${C.reset} ✖ ${C.gray}Keluar${C.reset}\n`);

    const choice = await promptQuestion(rl, 'Pilih nomor menu:');

    try {
      switch (choice) {
        case '1': {
          console.log(`\n${C.dim}⏳ Mengambil data Home...${C.reset}`);
          const res = await getHome();
          const updates = res.data?.latestUpdates || [];
          console.log(`\n${C.bold}⚡ EPISODE TERBARU:${C.reset}`);
          updates.slice(0, 15).forEach((item, idx) => {
            console.log(` ${C.coral}[${idx + 1}]${C.reset} ${item.title}`);
          });
          const pick = await promptQuestion(rl, `\nPilih nomor episode (1-${Math.min(updates.length, 15)}) untuk streaming, atau [Enter] untuk full JSON:`);
          if (pick && !isNaN(pick) && updates[parseInt(pick, 10) - 1]) {
            const chosen = updates[parseInt(pick, 10) - 1];
            console.log(`\n${C.dim}⏳ Mengambil streaming link untuk: ${chosen.title}...${C.reset}`);
            const epRes = await getEpisodeDetail(chosen.slug);
            printJsonResult(epRes);
          } else {
            printJsonResult(res);
          }
          break;
        }

        case '2': {
          const q = await promptQuestion(rl, 'Masukkan judul anime:');
          if (!q) { console.log(`${C.coral}Kata kunci tidak boleh kosong.${C.reset}`); break; }
          console.log(`\n${C.dim}⏳ Mencari "${q}"...${C.reset}`);
          const res = await searchAnime(q);
          const results = res.data?.results || [];
          if (results.length === 0) {
            printJsonResult(res);
            break;
          }
          console.log(`\n${C.bold}HASIL PENCARIAN (${results.length}):${C.reset}`);
          results.forEach((item, idx) => {
            console.log(` ${C.coral}[${idx + 1}]${C.reset} ${item.title} ${C.dim}(★ ${item.score || 'N/A'} · ${item.type})${C.reset}`);
          });
          const pick = await promptQuestion(rl, `\nPilih nomor anime (1-${results.length}) untuk lihat detail:`);
          if (pick && !isNaN(pick) && results[parseInt(pick, 10) - 1]) {
            const chosen = results[parseInt(pick, 10) - 1];
            console.log(`\n${C.dim}⏳ Mengambil detail ${chosen.title}...${C.reset}`);
            const detailRes = await getAnimeDetail(chosen.slug);
            const episodes = detailRes.data?.episodes || [];
            console.log(`\n${C.bold}DAFTAR EPISODE:${C.reset}`);
            episodes.slice(0, 10).forEach((ep, idx) => {
              console.log(` ${C.coral}[${idx + 1}]${C.reset} ${ep.title}`);
            });
            const epPick = await promptQuestion(rl, `\nPilih nomor episode untuk streaming (1-${Math.min(episodes.length, 10)}), atau [Enter] untuk detail:`);
            if (epPick && !isNaN(epPick) && episodes[parseInt(epPick, 10) - 1]) {
              const chosenEp = episodes[parseInt(epPick, 10) - 1];
              console.log(`\n${C.dim}⏳ Mengambil stream link...${C.reset}`);
              const epData = await getEpisodeDetail(chosenEp.slug);
              printJsonResult(epData);
            } else {
              printJsonResult(detailRes);
            }
          } else {
            printJsonResult(res);
          }
          break;
        }

        case '3': {
          const slug = await promptQuestion(rl, 'Masukkan slug anime:');
          if (!slug) break;
          console.log(`\n${C.dim}⏳ Mengambil detail...${C.reset}`);
          const res = await getAnimeDetail(slug);
          printJsonResult(res);
          break;
        }

        case '4': {
          let epSlug = await promptQuestion(rl, 'Masukkan slug episode (contoh: one-piece-episode-1000-subtitle-indonesia):');
          if (!epSlug) break;
          console.log(`\n${C.dim}⏳ Mengambil stream mirrors...${C.reset}`);
          const res = await getEpisodeDetail(epSlug);
          if (res.data?.streamMirrors?.length > 0) {
            console.log(`\n${C.bold}🎬 STREAM MIRRORS DITEMUKAN (${res.data.streamMirrors.length}):${C.reset}`);
            res.data.streamMirrors.forEach((s, i) => {
              console.log(` ${C.coral}[${i + 1}]${C.reset} ${s.quality || 'auto'} - ${s.server || 'SOKUJA'} ${C.dim}(${s.type})${C.reset}`);
              console.log(`    ${C.gray}${s.streamUrl}${C.reset}`);
            });
          }
          printJsonResult(res);
          break;
        }

        case '5': {
          console.log(`\n${C.dim}⏳ Mengambil katalog A-Z...${C.reset}`);
          const res = await getAnimeListMode();
          const alphabet = res.data?.alphabetIndex || [];
          console.log(`\n${C.bold}ALPHABET INDEX:${C.reset} ${alphabet.join(' ')}`);
          const letter = await promptQuestion(rl, 'Pilih huruf untuk lihat list anime:');
          if (letter && res.data?.catalog?.[letter.toUpperCase()]) {
            const items = res.data.catalog[letter.toUpperCase()];
            console.log(`\n${C.bold}ANIME HURUF ${letter.toUpperCase()}:${C.reset}`);
            items.forEach((item, idx) => {
              console.log(` ${C.coral}[${idx + 1}]${C.reset} ${item.title}`);
            });
          } else {
            printJsonResult(res);
          }
          break;
        }

        case '6': {
          const status = await promptQuestion(rl, 'Status [ongoing/completed] (default: ongoing):') || 'ongoing';
          const page = await promptQuestion(rl, 'Halaman (default: 1):') || '1';
          console.log(`\n${C.dim}⏳ Mengambil daftar anime...${C.reset}`);
          const res = await getAnimeFilter({ status, page: parseInt(page, 10) });
          printJsonResult(res);
          break;
        }

        case '7': {
          console.log(`\n${C.dim}⏳ Mengambil jadwal rilis...${C.reset}`);
          const res = await getSchedule();
          const days = Object.keys(res.data?.schedule || {});
          console.log(`\n${C.bold}PILIH HARI:${C.reset}`);
          days.forEach((day, idx) => {
            const count = res.data.schedule[day]?.length || 0;
            console.log(` ${C.coral}[${idx + 1}]${C.reset} ${day} ${C.dim}(${count} anime)${C.reset}`);
          });
          const pick = await promptQuestion(rl, `Pilih nomor hari (1-${days.length}) untuk lihat list:`);
          if (pick && !isNaN(pick) && days[parseInt(pick, 10) - 1]) {
            const chosenDay = days[parseInt(pick, 10) - 1];
            const list = res.data.schedule[chosenDay];
            console.log(`\n${C.bold}JADWAL ${chosenDay.toUpperCase()}:${C.reset}`);
            list.forEach((a, idx) => {
              console.log(` ${C.coral}[${idx + 1}]${C.reset} [${a.airingTime}] ${a.title}`);
            });
            const aPick = await promptQuestion(rl, `\nPilih nomor anime untuk detail:`);
            if (aPick && !isNaN(aPick) && list[parseInt(aPick, 10) - 1]) {
              const chosen = list[parseInt(aPick, 10) - 1];
              console.log(`\n${C.dim}⏳ Mengambil detail...${C.reset}`);
              const detailRes = await getAnimeDetail(chosen.slug);
              printJsonResult(detailRes);
            }
          } else {
            printJsonResult(res);
          }
          break;
        }

        case '8': {
          console.log(`\n${C.dim}⏳ Mengambil daftar genre...${C.reset}`);
          const res = await getGenres();
          const genres = res.data?.genres || [];
          console.log(`\n${C.bold}DAFTAR GENRE:${C.reset}`);
          genres.slice(0, 20).forEach((g, idx) => {
            console.log(` ${C.coral}[${idx + 1}]${C.reset} ${g.name}`);
          });
          const pick = await promptQuestion(rl, `\nPilih nomor genre (1-${Math.min(genres.length, 20)}) untuk list anime:`);
          if (pick && !isNaN(pick) && genres[parseInt(pick, 10) - 1]) {
            const chosen = genres[parseInt(pick, 10) - 1];
            console.log(`\n${C.dim}⏳ Mengambil anime genre ${chosen.name}...${C.reset}`);
            const listRes = await getAnimeByGenre(chosen.slug);
            printJsonResult(listRes);
          } else {
            printJsonResult(res);
          }
          break;
        }

        case '9': {
          console.log(`\n${C.bold}🍪 SET COOKIE${C.reset}`);
          console.log(`${C.dim}Cookies bisa membantu mengakses konten yang membutuhkan autentikasi.${C.reset}`);
          const cookieInput = await promptQuestion(rl, 'Masukkan cookie string (format: key1=value1; key2=value2):');
          if (cookieInput) {
            const cookies = {};
            cookieInput.split(';').forEach(part => {
              const [key, value] = part.trim().split('=');
              if (key && value) cookies[key] = value;
            });
            const current = loadCookies();
            saveCookies({ ...current, ...cookies });
            console.log(`${C.green}✔ Cookie saved! (${Object.keys(cookies).length} entries)${C.reset}`);
          }
          break;
        }

        case 's':
        case 'S': {
          const portInput = await promptQuestion(rl, 'Port server (default: 3000):') || '3000';
          const port = parseInt(portInput, 10) || 3000;
          startServer(port);
          console.log(`${C.green}✔ Server running on http://localhost:${port}${C.reset}`);
          console.log(`${C.dim}Tekan Ctrl+C untuk stop server dan kembali ke menu.${C.reset}`);
          break;
        }

        case '0': {
          console.log(`\n${C.green}Terima kasih telah menggunakan SOKUJA Scraper!${C.reset}\n`);
          running = false;
          rl.close();
          process.exit(0);
        }

        default: {
          console.log(`${C.coral}Pilihan tidak valid.${C.reset}`);
        }
      }
    } catch (err) {
      printJsonResult(formatError(err));
    }

    if (running) {
      await promptQuestion(rl, '\nTekan [Enter] untuk kembali ke menu utama...');
    }
  }
}

// ==========================================
// 🏁 ENTRY POINT
// ==========================================
const currentFilePath = fileURLToPath(import.meta.url);
const isDirectExecution = process.argv[1] && (
  process.argv[1] === currentFilePath ||
  process.argv[1].replace(/\\/g, '/') === currentFilePath.replace(/\\/g, '/')
);

if (isDirectExecution) {
  const args = process.argv.slice(2);
  if (args.includes('--server') || args.includes('-s') || args.includes('serve')) {
    const portArg = args.find(a => a.startsWith('--port='))?.split('=')[1] || 3000;
    startServer(Number(portArg) || 3000);
  } else if (args.includes('--cache-clear')) {
    try {
      const files = fs.readdirSync(CONFIG.cacheDir);
      for (const file of files) {
        fs.unlinkSync(path.join(CONFIG.cacheDir, file));
      }
      console.log(`✅ Cache cleared (${files.length} files)`);
    } catch (_) {}
  } else {
    runCli();
  }
}

// ==========================================
// 📤 EKSPOR UNTUK API.JS & VERCEl
// ==========================================
import express from 'express';
import cors from 'cors';
import serverless from 'serverless-http';
import {
  getHome,
  searchAnime,
  getAnimeDetail,
  getEpisodeDetail,
  getAnimeListMode,
  getAnimeFilter,
  getSchedule,
  getGenres,
  getAnimeByGenre,
  getComments,
  formatResponse,
  formatError,
  loadCookies,
  saveCookies,
  fetchWithRetry,
  BASE_URL,
  AUTHOR_NAME
} from './server.js';

// ==========================================
// 🚀 BUAT EXPRESS APP
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware (opsional untuk Vercel)
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.originalUrl}`);
  next();
});

// ==========================================
// 📍 ROUTES (sama seperti di server.js)
// ==========================================

// Root
app.get('/', (req, res) => {
  res.json(formatResponse({
    name: 'SOKUJA REST API Scraper Service',
    creator: AUTHOR_NAME,
    version: '2.0.0',
    deployed: 'Vercel',
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
      cookie: 'POST /api/cookie'
    }
  }, 'SOKUJA REST API by ZeroTzy.ID is running on Vercel'));
});

// Home - handle IP blocked dengan return 403 yang jelas
app.get('/api/home', async (req, res) => {
  try {
    const data = await getHome();
    // Jika data stale karena IP diblokir, tetap return 200 tapi kasih flag
    if (data?._blocked) return res.json(data);
    res.json(data);
  } catch (err) {
    const e = formatError(err);
    res.status(e.statusCode || 500).json(e);
  }
});

// Latest - fix field: server.js pakai 'latest' bukan 'latestUpdates'
app.get('/api/latest', async (req, res) => {
  try {
    const home = await getHome();
    const latest = home.data?.latest || home.data?.latestUpdates || [];
    res.json(formatResponse({
      total: latest.length,
      latest
    }, 'Latest episode updates retrieved'));
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Popular - fix field: server.js pakai 'popular' bukan 'popularAnime'
app.get('/api/popular', async (req, res) => {
  try {
    const home = await getHome();
    const popular = home.data?.popular || home.data?.popularAnime || [];
    res.json(formatResponse({
      total: popular.length,
      popular
    }, 'Popular anime retrieved'));
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Search
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

// Anime List Mode
app.get('/api/anime/list-mode', async (req, res) => {
  try {
    res.json(await getAnimeListMode());
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Anime Detail
app.get('/api/anime/:slug', async (req, res) => {
  try {
    const slug = req.params.slug?.trim();
    if (!slug) return res.status(400).json(formatError('Anime slug is required', 400));
    res.json(await getAnimeDetail(slug));
  } catch (err) {
    res.status(404).json(formatError(err, 404));
  }
});

// Anime Filter
app.get('/api/anime', async (req, res) => {
  try {
    const { status, type, order, page } = req.query;
    res.json(await getAnimeFilter({ status, type, order, page }));
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Episode Detail
app.get('/api/episode/:slug', async (req, res) => {
  try {
    const slug = req.params.slug?.trim();
    if (!slug) return res.status(400).json(formatError('Episode slug is required', 400));
    res.json(await getEpisodeDetail(slug));
  } catch (err) {
    res.status(404).json(formatError(err, 404));
  }
});

// Stream Mirrors (khusus episodeId)
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
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Set Cookie - Vercel ready (update memory + /tmp)
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
      total: Object.keys(loadCookies()).length,
      note: 'Cookies tersimpan di memory + /tmp (akan hilang saat cold start, gunakan ENV SOKUJA_COOKIES untuk permanen)'
    }, 'Cookies saved successfully'));
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Debug cookie (cek cookie aktif)
app.get('/api/cookie', (req, res) => {
  try {
    const cookies = loadCookies();
    const keys = Object.keys(cookies);
    res.json(formatResponse({
      total: keys.length,
      keys,
      // jangan expose value penuh untuk keamanan, cuma preview
      preview: Object.fromEntries(Object.entries(cookies).map(([k,v]) => [k, String(v).slice(0,15)+'...']))
    }, 'Cookie status OK'));
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Schedule
app.get('/api/schedule', async (req, res) => {
  try {
    res.json(await getSchedule());
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Genres
app.get('/api/genres', async (req, res) => {
  try {
    res.json(await getGenres());
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Genre Anime
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

// Comments
app.get('/api/comments', async (req, res) => {
  try {
    const { episodeId, animeId, limit, cursor } = req.query;
    res.json(await getComments({ episodeId, animeId, limit, cursor }));
  } catch (err) {
    res.status(formatError(err).statusCode||500).json(formatError(err));
  }
});

// Clear cache - sekarang support Vercel (/tmp/.cache)
app.delete('/api/cache', (req, res) => {
  try {
    // Hapus cache di /tmp/.cache untuk Vercel
    import('fs').then(fsMod => {
      const fs = fsMod.default;
      import('path').then(pathMod => {
        const path = pathMod.default;
        const cacheDir = process.env.VERCEL ? '/tmp/.cache' : path.join(process.cwd(), '.cache');
        try {
          if (fs.existsSync(cacheDir)) {
            const files = fs.readdirSync(cacheDir);
            files.forEach(f => { try { fs.unlinkSync(path.join(cacheDir, f)); } catch(_){} });
            return res.json(formatResponse({ cleared: files.length, location: cacheDir }, 'Cache cleared'));
          }
          return res.json(formatResponse({ cleared: 0, location: cacheDir }, 'Cache empty'));
        } catch (e) {
          return res.status(formatError(e).statusCode||500).json(formatError(e));
        }
      });
    });
  } catch (e) {
    res.status(formatError(e).statusCode||500).json(formatError(e));
  }
});

// 404
app.use((req, res) => {
  res.status(404).json(formatError(`Endpoint '${req.method} ${req.originalUrl}' not found`, 404));
});

// Error handler
app.use((err, req, res, next) => {
  res.status(500).json(formatError(err?.message || 'Internal Server Error', 500));
});

// ==========================================
// 📤 EXPORT untuk Vercel
// ==========================================
// Vercel butuh export default untuk serverless
export const handler = serverless(app);
export const config = { api: { bodyParser: false } };

// Untuk local testing (optional)
// Jika dijalankan langsung: node api.js
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Local server running on http://localhost:${port}`);
  });
}

export default app;
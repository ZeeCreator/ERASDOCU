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

// Home
app.get('/api/home', async (req, res) => {
  try {
    res.json(await getHome());
  } catch (err) {
    res.status(500).json(formatError(err));
  }
});

// Latest
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

// Popular
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
    res.status(500).json(formatError(err));
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
    res.status(500).json(formatError(err));
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
    res.status(500).json(formatError(err));
  }
});

// Set Cookie
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

// Schedule
app.get('/api/schedule', async (req, res) => {
  try {
    res.json(await getSchedule());
  } catch (err) {
    res.status(500).json(formatError(err));
  }
});

// Genres
app.get('/api/genres', async (req, res) => {
  try {
    res.json(await getGenres());
  } catch (err) {
    res.status(500).json(formatError(err));
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
    res.status(500).json(formatError(err));
  }
});

// Clear cache (hanya untuk development, di Vercel tidak akan berfungsi karena file system read-only)
app.delete('/api/cache', (req, res) => {
  res.json(formatResponse({
    message: 'Cache clear only works in local environment'
  }, 'Not available on Vercel'));
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
export const handler = serverless(app);

// Untuk local testing (optional)
// Jika dijalankan langsung: node api.js
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Local server running on http://localhost:${port}`);
  });
}

export default app;
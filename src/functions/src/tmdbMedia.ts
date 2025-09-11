import * as functions from 'firebase-functions';
import cors from 'cors';
import fetch from 'node-fetch';

const corsHandler = cors({ origin: true });

export default functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // --- CORS preflight
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    try {
      res.set('Access-Control-Allow-Origin', req.headers.origin || '*');

      const { kind, tmdbId } = req.body;
      if ((kind !== 'movie' && kind !== 'tv') || !tmdbId) {
        res.status(400).json({ error: 'Invalid parameters' });
        return;
      }

      const apiKey = functions.config().tmdb.key;
      const url = `https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${apiKey}&append_to_response=images,videos`;

      const tmdbRes = await fetch(url);
      if (!tmdbRes.ok) {
        throw new Error(`TMDB fetch failed: ${tmdbRes.statusText}`);
      }

      const data = await tmdbRes.json();

      const posters = (data.images?.posters || []).map((p: any) => ({
        url: `https://image.tmdb.org/t/p/w500${p.file_path}`,
        width: p.width,
        height: p.height,
        lang: p.iso_639_1,
      }));

      const backdrops = (data.images?.backdrops || []).map((b: any) => ({
        url: `https://image.tmdb.org/t/p/w780${b.file_path}`,
        width: b.width,
        height: b.height,
        lang: b.iso_639_1,
      }));

      const videos = (data.videos?.results || [])
        .filter((v: any) => v.site === 'YouTube')
        .map((v: any) => ({
          key: v.key,
          site: v.site,
          type: v.type,
          name: v.name,
          thumbnailUrl: `https://i.ytimg.com/vi/${v.key}/hqdefault.jpg`,
        }));

      res.status(200).json({ posters, backdrops, videos });
    } catch (error: any) {
      functions.logger.error('Error in tmdbMedia:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

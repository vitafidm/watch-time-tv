import * as functions from 'firebase-functions';
import cors from 'cors';
import * as admin from 'firebase-admin';
import { tmdbFetch, posterUrl, backdropUrl } from './tmdbClient';

const corsHandler = cors({ origin: true });

function getYear(dateString: string | undefined | null): number | null {
  if (!dateString) return null;
  const year = parseInt(dateString.substring(0, 4), 10);
  return isNaN(year) ? null : year;
}

export default functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
        }
        await admin.auth().verifyIdToken(authHeader.substring('Bearer '.length));

      const { kind, tmdbId } = req.body;

      if (!tmdbId || typeof tmdbId !== 'number') {
        res.status(400).json({ error: 'Missing or invalid "tmdbId" parameter.' });
        return;
      }
      if (kind !== 'movie' && kind !== 'tv') {
        res.status(400).json({ error: 'Invalid "kind" parameter. Must be "movie" or "tv".' });
        return;
      }

      const details = await tmdbFetch(`${kind}/${tmdbId}`, { append_to_response: 'images,videos' });

      if (!details) {
        throw new functions.https.HttpsError('not-found', `Could not find media for ID ${tmdbId}`);
      }

      const posters = (details.images?.posters || []).map((p: any) => ({
          url: posterUrl(p.file_path, 'w500'),
          width: p.width,
          height: p.height,
          lang: p.iso_639_1 || null
      }));

      const backdrops = (details.images?.backdrops || []).map((b: any) => ({
          url: backdropUrl(b.file_path, 'w780'),
          width: b.width,
          height: b.height,
          lang: b.iso_639_1 || null
      }));

      const videos = (details.videos?.results || [])
        .filter((v: any) => v.site === 'YouTube')
        .map((v: any) => ({
            key: v.key,
            site: v.site,
            type: v.type,
            name: v.name,
            thumbnailUrl: `https://i.ytimg.com/vi/${v.key}/hqdefault.jpg`
        }));


      res.status(200).json({ posters, backdrops, videos });

    } catch (error: any) {
      functions.logger.error('Error in tmdbMedia:', error);
      const code = error.code || 'internal';
      const message = error.message || 'An internal error occurred.';
      const httpStatus = code === 'unauthenticated' ? 401 :
                         code === 'not-found' ? 404 :
                         code === 'invalid-argument' ? 400 : 500;
      res.status(httpStatus).json({ error: { code, message } });
    }
  });
});

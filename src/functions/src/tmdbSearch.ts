import * as functions from 'firebase-functions';
import * as cors from 'cors';
import { searchMovie, searchTV, posterUrl } from './tmdbClient';

const corsHandler = cors({ origin: true });

function getYear(dateString: string | undefined | null): number | null {
  if (!dateString) return null;
  const year = parseInt(dateString.substring(0, 4), 10);
  return isNaN(year) ? null : year;
}

export default functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
      const { q, kind, year, page = 1 } = req.body;

      if (!q || typeof q !== 'string') {
        res.status(400).json({ error: 'Missing or invalid query parameter "q".' });
        return;
      }
      if (kind !== 'movie' && kind !== 'tv') {
        res.status(400).json({ error: 'Invalid "kind" parameter. Must be "movie" or "tv".' });
        return;
      }

      let tmdbResults;
      if (kind === 'movie') {
        tmdbResults = await searchMovie(q, year, page);
      } else {
        tmdbResults = await searchTV(q, year, page);
      }
      
      if (!tmdbResults || !Array.isArray(tmdbResults.results)) {
        res.status(500).json({ error: 'Failed to fetch from TMDB or malformed response.' });
        return;
      }

      const results = tmdbResults.results.slice(0, 10).map((item: any) => {
        if (kind === 'movie') {
          return {
            id: item.id,
            title: item.title,
            year: getYear(item.release_date),
            posterUrl: posterUrl(item.poster_path, 'w185'),
          };
        } else { // kind === 'tv'
          return {
            id: item.id,
            title: item.name,
            year: getYear(item.first_air_date),
            posterUrl: posterUrl(item.poster_path, 'w185'),
          };
        }
      });

      res.status(200).json(results);

    } catch (error: any) {
      functions.logger.error('Error in tmdbSearch:', error);
      res.status(500).json({ error: 'An internal error occurred.' });
    }
  });
});

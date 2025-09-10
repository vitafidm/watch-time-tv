
import * as functions from 'firebase-functions';
import fetch from 'node-fetch';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE_URL = 'https://image.tmdb.org/t/p/';

// Helper to pause execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getApiKey(): string {
    try {
        const key = functions.config().tmdb.key;
        if (!key) {
            throw new Error('TMDB API key is missing from function configuration.');
        }
        return key;
    } catch (e) {
        // Fallback for local testing if not using functions config
        if (process.env.TMDB_API_KEY) {
            return process.env.TMDB_API_KEY;
        }
        throw new Error('TMDB API key not found in functions.config().tmdb.key or process.env.TMDB_API_KEY');
    }
}

async function tmdbFetch(path: string, params: Record<string, string>) {
    const apiKey = getApiKey();
    const url = new URL(`${TMDB_BASE_URL}/${path}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('language', 'en-US');

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    
    await sleep(150); // Be gentle with the API
    const response = await fetch(url.toString());
    if (!response.ok) {
        console.error(`TMDB API Error: ${response.status} for URL: ${url.toString()}`);
        return null;
    }
    return response.json();
}

export async function searchMovie(title: string, year?: number | null): Promise<any> {
    const params: Record<string, string> = { query: title, include_adult: 'false' };
    if (year) {
        params.year = String(year);
    }
    return tmdbFetch('search/movie', params);
}

export async function searchTV(title: string): Promise<any> {
    return tmdbFetch('search/tv', { query: title, include_adult: 'false' });
}

export async function movieDetails(id: number): Promise<any> {
    return tmdbFetch(`movie/${id}`, { append_to_response: 'videos,credits' });
}

export async function tvDetails(id:number): Promise<any> {
    return tmdbFetch(`tv/${id}`, { append_to_response: 'videos,aggregate_credits' });
}

export function posterUrl(path?: string, size: 'w500' | 'original' = 'w500'): string | null {
    return path ? `${IMG_BASE_URL}${size}${path}` : null;
}

export function backdropUrl(path?: string, size: 'w780'|'original' = 'w780'): string | null {
    return path ? `${IMG_BASE_URL}${size}${path}` : null;
}

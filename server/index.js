/**
 * Private Cinema - Simple Node.js Mock NAS Server
 * ------------------------------------------------
 * This server simulates a local media server (like one on a Synology NAS)
 * for development and testing purposes. It provides three main endpoints:
 *
 * GET /health: A simple health check to confirm the server is running.
 * POST /scan: Scans predefined directories (from environment variables)
 *             and writes the found media files to a local `catalog.json`.
 * POST /push: Reads the `catalog.json` and pushes its contents to the
 *             live `agentIngest` Firebase Function using a secure API key.
 *
 * ---
 * Environment Variables:
 * - PORT: The port to run this server on (default: 4000).
 * - MOVIES_PATH: The absolute path to the movies directory to scan.
 * - TV_PATH: The absolute path to the TV shows directory to scan.
 * - AGENT_INGEST_URL: The URL of the deployed `agentIngest` Firebase Function.
 * - AGENT_API_KEY: The permanent API key obtained from the `agentClaim` flow.
 */
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 4000;
const DATA_DIR = '.data';
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');

// --- Utility Functions ---

/** Sends a JSON response with a given status code. */
function sendJSON(res, data, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

/** Handles preflight CORS requests. */
function handleCors(req, res) {
    res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
}

/** Reads the catalog file from disk. */
async function readCatalog() {
  try {
    const data = await fs.readFile(CATALOG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return { items: [] }; // Return empty if not found
    throw error;
  }
}

/**
 * Scans a directory for media files and generates metadata.
 * Note: This is a simplified mock and does not extract real metadata.
 */
async function scanDirectory(dirPath, type) {
  if (!dirPath) return [];
  try {
    const files = await fs.readdir(dirPath);
    return files
        .filter(f => f.endsWith('.mkv') || f.endsWith('.mp4'))
        .map(filename => ({
            title: path.basename(filename, path.extname(filename)).replace(/\./g, ' '),
            filename,
            path: path.join(dirPath, filename),
            type,
            size: 1, // Mock data
            duration: 1, // Mock data
    }));
  } catch (error) {
    console.warn(`Warning: Could not scan directory ${dirPath}.`, error.message);
    return [];
  }
}

// --- Main Server Logic ---

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    return handleCors(req, res);
  }
  
  if (req.method === 'GET' && pathname === '/health') {
    return sendJSON(res, { status: 'ok', timestamp: new Date().toISOString() });
  }

  if (req.method === 'POST' && pathname === '/scan') {
    const moviesPath = process.env.MOVIES_PATH;
    const tvPath = process.env.TV_PATH;

    if (!moviesPath || !tvPath) {
      return sendJSON(res, { error: 'MOVIES_PATH and TV_PATH must be set in environment' }, 500);
    }
    
    const movieItems = await scanDirectory(moviesPath, 'movie');
    const tvItems = await scanDirectory(tvPath, 'episode');
    const catalog = { items: [...movieItems, ...tvItems], scannedAt: new Date().toISOString() };
    
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2));

    return sendJSON(res, catalog);
  }
  
  if (req.method === 'POST' && pathname === '/push') {
    const { AGENT_INGEST_URL, AGENT_API_KEY } = process.env;
    if (!AGENT_INGEST_URL || !AGENT_API_KEY) {
      const msg = "Server is missing AGENT_INGEST_URL or AGENT_API_KEY environment variables.";
      return sendJSON(res, { error: msg }, 500);
    }

    try {
      const { items } = await readCatalog();
      if (!items || items.length === 0) {
        return sendJSON(res, { status: 200, body: { message: "No items in local catalog to push." } });
      }

      const r = await fetch(AGENT_INGEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AGENT_API_KEY}`
        },
        body: JSON.stringify({ items }),
      });
      
      const body = await r.json().catch(() => ({ raw: "Could not parse JSON response from function." }));
      return sendJSON(res, { status: r.status, body });

    } catch (e) {
      console.error("Error during /push flow:", e);
      return sendJSON(res, { error: String(e) }, 500);
    }
  }

  return sendJSON(res, { error: 'Not Found' }, 404);
});

server.listen(PORT, () => {
  console.log(`Mock NAS server running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});

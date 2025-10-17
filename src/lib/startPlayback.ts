// src/lib/startPlayback.ts
export async function getPlaybackUrl(mediaId: string, idToken: string) {
    const endpoint = 'https://us-central1-watchtimetv2.cloudfunctions.net/startPlayback';
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ mediaId }),
    });
  
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || `startPlayback failed: ${resp.status}`);
    }
  
    const json = await resp.json();
    // { url: string, expiresAt: number }
    return json as { url: string; expiresAt: number };
  }
  
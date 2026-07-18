const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /screenshot
   Returns the actual ad image from Facebook without Puppeteer.
   Extracts og:image or fbcdn images from HTML.
   ══════════════════════════════════════════════════════════ */
app.get('/screenshot', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });
  try { new URL(url); } catch { return res.status(400).json({ status: 'error', message: 'Invalid URL' }); }

  try {
    // Fetch the ad page HTML from Facebook
    const response = await axios.get(url, {
      timeout: 20000,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://www.facebook.com/',
      },
      responseType: 'text',
      maxRedirects: 5,
    });

    const html = response.data;

    // Strategy 1: Extract og:image
    const ogImgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImgMatch) {
      const imgUrl = ogImgMatch[1];
      console.log('Found og:image:', imgUrl.substring(0, 80));
      return await serveImage(res, imgUrl);
    }

    // Strategy 2: Find fbcdn images in HTML
    const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    const fbcdnImages = imgMatches
      .map(m => m[1])
      .filter(src => src.includes('fbcdn.net') || src.includes('cdninstagram.com'))
      .filter(src => !src.includes('emoji') && !src.includes('icon'))
      .map(src => {
        // Upgrade thumbnail to full size
        return src
          .replace(/\/s\d+x\d+\//, '/s1080x1080/')
          .replace(/[\/?&]oh=[^&]+/g, '')
          .replace(/[\/?&]oe=[^&]+/g, '')
          .replace(/[\/?&]s=\d+/g, '');
      });

    if (fbcdnImages.length > 0) {
      console.log('Found fbcdn image:', fbcdnImages[0].substring(0, 80));
      return await serveImage(res, fbcdnImages[0]);
    }

    // Strategy 3: Look for video poster
    const videoPosterMatch = html.match(/poster=["']([^"']+)["']/i);
    if (videoPosterMatch) {
      console.log('Found video poster:', videoPosterMatch[1].substring(0, 80));
      return await serveImage(res, videoPosterMatch[1]);
    }

    // No image found - return empty response
    console.log('No image found in ad HTML');
    res.status(404).json({ status: 'error', message: 'No image found' });

  } catch (err) {
    console.error('Screenshot error:', err.message);
    res.status(502).json({ status: 'error', message: 'Failed: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /api/video
   ══════════════════════════════════════════════════════════ */
app.get('/api/video', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ video: null });

  try {
    const response = await axios.get(url, {
      timeout: 20000,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': 'https://www.facebook.com/',
      },
      responseType: 'text',
    });

    const html = response.data;

    // Look for video URLs
    const patterns = [
      /"playable_url"\s*:\s*"([^"]+)"/,
      /"browser_native_hd_url"\s*:\s*"([^"]+)"/,
      /"browser_native_sd_url"\s*:\s*"([^"]+)"/,
      /"hd_src"\s*:\s*"([^"]+)"/,
      /"sd_src"\s*:\s*"([^"]+)"/,
      /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
      /"video_url"\s*:\s*"([^"]+)"/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        let videoUrl = match[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        return res.json({ video: videoUrl });
      }
    }

    res.json({ video: null });

  } catch (err) {
    console.error('Video detection error:', err.message);
    res.json({ video: null });
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /health
   ══════════════════════════════════════════════════════════ */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: 'v8-no-puppeteer',
  });
});

/* ══════════════════════════════════════════════════════════
   HELPER: serveImage
   Fetches an image from URL and returns it through the API
   ══════════════════════════════════════════════════════════ */
async function serveImage(res, imgUrl) {
  try {
    const imgResponse = await axios.get(imgUrl, {
      timeout: 15000,
      httpAgent,
      httpsAgent,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.facebook.com/',
      },
      maxRedirects: 5,
    });

    const contentType = imgResponse.headers['content-type'] || 'image/jpeg';
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Content-Length': imgResponse.data.length,
    });
    res.send(imgResponse.data);

  } catch (err) {
    console.error('Failed to fetch image:', err.message);
    res.status(502).json({ status: 'error', message: 'Failed to fetch image: ' + err.message });
  }
}

app.listen(parseInt(process.env.PORT || '3000', 10), '0.0.0.0', () => {
  console.log('AdSpy Media API v8 running (no Puppeteer)');
  console.log('GET /screenshot?url=...  (returns ad image)');
  console.log('GET /api/video?url=...   (extracts video URL)');
  console.log('GET /health');
});
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// HTTP agents with keep-alive for better performance
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ 
  keepAlive: true,
  rejectUnauthorized: false 
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /screenshot — Proxy to Facebook's own rendered ad
   This doesn't use Puppeteer. It fetches the actual ad creative
   from Facebook's servers directly.
   ══════════════════════════════════════════════════════════ */
app.get('/screenshot', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });
  
  try {
    // Fetch the actual page content from Facebook
    const response = await axios.get(url, {
      timeout: 15000,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://www.facebook.com/',
      },
      responseType: 'arraybuffer',
      maxRedirects: 5,
    });

    const contentType = response.headers['content-type'] || 'text/html';
    
    // If it's an image, return it directly
    if (contentType.startsWith('image/')) {
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': response.data.length,
      });
      return res.send(response.data);
    }

    // If it's HTML, extract ad content or return as-is
    if (contentType.includes('text/html')) {
      const html = response.data.toString('utf-8');
      
      // Try multiple strategies to get the full-size ad image
      
      // Strategy 1: Look for high-res images in the HTML (not thumbnails)
      // Facebook stores images in multiple sizes: /s220x220/, /s600x600/, /s720x720/, etc.
      // We want the largest version: replace small sizes with larger ones
      const allImgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
      const metaImgMatch2 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      
      let bestImgUrl = null;
      
      // First try meta og:image
      if (metaImgMatch2) {
        let ogUrl = metaImgMatch2[1];
        // Upgrade thumbnail to full size
        ogUrl = ogUrl
          .replace(/\/s\d+x\d+\//, '/s1080x1080/')  // Upgrade to 1080p
          .replace(/[\/?&]oh=[^&]+/g, '')
          .replace(/[\/?&]oe=[^&]+/g, '');
        bestImgUrl = ogUrl;
      }
      
      // Try to find a larger image from img tags
      const fbCdnImages = allImgMatches
        .map(m => m[1])
        .filter(src => src.includes('fbcdn.net') || src.includes('cdninstagram.com'))
        .map(src => src
          .replace(/\/s\d+x\d+\//, '/s1080x1080/')
          .replace(/[\/?&]oh=[^&]+/g, '')
          .replace(/[\/?&]oe=[^&]+/g, '')
          .replace(/[\/?&]s=\d+/g, '')
        );
      
      // Pick the largest resolution we can find
      const sizeOrder = ['s1080x1080', 's720x720', 's600x600', 's320x320', 's220x220'];
      for (const size of sizeOrder) {
        const found = fbCdnImages.find(url => url.includes(size));
        if (found) {
          bestImgUrl = found;
          break;
        }
      }
      
      // If still no image, use the first fbcdn image we found
      if (!bestImgUrl && fbCdnImages.length > 0) {
        bestImgUrl = fbCdnImages[0];
      }
      
      if (bestImgUrl) {
        console.log('Fetching full-size image:', bestImgUrl.substring(0, 80));
        try {
          const imgResponse = await axios.get(bestImgUrl, {
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
          
          res.set({
            'Content-Type': imgResponse.headers['content-type'] || 'image/jpeg',
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': imgResponse.data.length,
          });
          return res.send(imgResponse.data);
        } catch(e) {
          console.log('Failed to fetch full-size image:', e.message);
          // Fall through to return HTML
        }
      }
      
      // Return the HTML with base tag for proper resource loading
      const fixedHtml = html.replace(
        '<head>',
        `<head><base href="https://www.facebook.com/">`
      );
      res.set({ 'Content-Type': 'text/html; charset=utf-8' });
      return res.send(fixedHtml);
    }

    // For other content types, proxy directly
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    });
    res.send(response.data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    
    // Fallback: if Facebook returns a login page, extract whatever we can
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;
      
      // Try to extract og:image from error response
      if (data && data.toString) {
        const html = data.toString();
        const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
        if (ogImg) {
          try {
            const imgRes = await axios.get(ogImg[1], {
              timeout: 10000, httpAgent, httpsAgent,
              responseType: 'arraybuffer',
              headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.facebook.com/' },
            });
            res.set({ 'Content-Type': imgRes.headers['content-type'] || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
            return res.send(imgRes.data);
          } catch(e) {}
        }
      }
      
      return res.status(status).json({ status: 'error', message: 'Facebook returned status ' + status });
    }
    
    res.status(502).json({ status: 'error', message: 'Proxy failed: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /api/video — Get video URL from Facebook ad
   ══════════════════════════════════════════════════════════ */
app.get('/api/video', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ video: null });

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      httpAgent, httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': 'https://www.facebook.com/',
      },
      responseType: 'text',
    });

    const html = response.data;
    
    // Look for video URLs in the HTML
    const patterns = [
      /"playable_url"\s*:\s*"([^"]+)"/,
      /"browser_native_hd_url"\s*:\s*"([^"]+)"/,
      /"browser_native_sd_url"\s*:\s*"([^"]+)"/,
      /"hd_src"\s*:\s*"([^"]+)"/,
      /"sd_src"\s*:\s*"([^"]+)"/,
      /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
      /"video_url"\s*:\s*"([^"]+)"/,
      /"src"\s*:\s*"([^"]+\.mp4[^"]*)"/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        // Unescape JSON unicode
        let videoUrl = match[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        return res.json({ video: videoUrl });
      }
    }

    // Also check for direct video tag
    const videoTag = html.match(/<video[^>]+src=["']([^"']+)["']/i);
    if (videoTag) {
      return res.json({ video: videoTag[1] });
    }

    res.json({ video: null });
    
  } catch (err) {
    console.error('Video detection error:', err.message);
    res.json({ video: null });
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /media — Get all media from Facebook ad
   ══════════════════════════════════════════════════════════ */
app.get('/media', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ status: 'error', message: 'Missing url' });

  const result = { video: null, images: [], ogImage: null };

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      httpAgent, httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': 'https://www.facebook.com/',
      },
      responseType: 'text',
    });

    const html = response.data;

    // Extract og:image
    const ogImgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImgMatch) result.ogImage = ogImgMatch[1];

    // Extract all images from the page
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    let imgMatch;
    const allImages = [];
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const src = imgMatch[1];
      if (src.startsWith('http') && (src.includes('fbcdn') || src.includes('cdninstagram'))) {
        allImages.push(src);
      }
    }
    result.images = [...new Set(allImages)].slice(0, 10);

    // Extract video
    const videoPatterns = [
      /"playable_url"\s*:\s*"([^"]+)"/,
      /"browser_native_hd_url"\s*:\s*"([^"]+)"/,
      /"browser_native_sd_url"\s*:\s*"([^"]+)"/,
      /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    ];
    for (const pattern of videoPatterns) {
      const match = html.match(pattern);
      if (match) {
        result.video = match[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        break;
      }
    }

    res.json({ status: 'success', data: result });

  } catch (err) {
    console.error('Media error:', err.message);
    res.json({ status: 'success', data: result });
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /render — Render the ad HTML directly
   This returns the Facebook ad page that users can view
   ══════════════════════════════════════════════════════════ */
app.get('/render', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      httpAgent, httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': 'https://www.facebook.com/',
      },
      responseType: 'text',
    });

    // Return the HTML with base href so resources load properly
    const html = response.data.replace(
      '<head>', 
      '<head><base href="https://www.facebook.com/">'
    );
    
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    res.status(502).send('Failed to fetch ad: ' + err.message);
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
    version: 'v5-no-puppeteer',
  });
});

app.listen(parseInt(process.env.PORT || '3000', 10), '0.0.0.0', () => {
  console.log('AdSpy Media API v5 running (no Puppeteer)');
  console.log('GET /screenshot?url=...  (proxies Facebook ad image)');
  console.log('GET /api/video?url=...   (extracts video from HTML)');
  console.log('GET /media?url=...       (extracts all media)');
  console.log('GET /render?url=...      (returns ad HTML)');
  console.log('GET /health');
});
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

/* ── Express config ─────────────────────────────────────── */
app.use(cors());
app.use(express.json());

/* ── Puppeteer browser singleton ────────────────────────── */
let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-accelerated-2d-canvas',
    '--single-process',
    '--no-first-run',
    '--no-zygote',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-web-resource',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-categories',
    '--no-default-shm-cache-size',
    '--no-pings',
    '--password-store=basic',
    '--use-gl=swiftshader',
    '--use-mock-keychain',
  ];

  browser = await puppeteer.launch({
    headless: 'new',
    args: launchArgs,
    timeout: 30000,
  });

  browser.on('disconnected', () => {
    browser = null;
  });

  return browser;
}

/* ── Helper: create a page with sensible defaults ───────── */
async function createPage(userAgent) {
  const br = await getBrowser();
  const page = await br.newPage();
  
  await page.setViewport({ width: 1366, height: 768 });
  
  // Custom or default user agent
  await page.setUserAgent(
    userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Block unnecessary resources to speed things up
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    // Block fonts, stylesheets, and other non-essential resources
    if (['font', 'media', 'image'].includes(type) && req.url().includes('facebook.com')) {
      // Allow specific media we might need
      req.continue();
    } else if (['stylesheet', 'font'].includes(type)) {
      req.continue();
    } else {
      req.continue();
    }
  });

  // Set a reasonable timeout
  page.setDefaultNavigationTimeout(25000);
  page.setDefaultTimeout(25000);

  return page;
}

/* ══════════════════════════════════════════════════════════
   ENDPOINT: POST /screenshot — Take a screenshot of a URL
   ══════════════════════════════════════════════════════════ */
app.get('/screenshot', async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).json({
      status: 'error',
      message: 'Missing "url" query parameter',
    });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid URL provided',
    });
  }

  const width = parseInt(req.query.width) || 500;
  const height = parseInt(req.query.height) || 700;
  const waitFor = parseInt(req.query.waitFor) || 3000;
  const fullPage = req.query.fullPage === 'true';

  let page = null;
  try {
    page = await createPage(req.query.userAgent);

    // Navigate to the URL
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    // Wait additional time for dynamic content
    await new Promise(r => setTimeout(r, waitFor));

    // Try to scroll to trigger lazy load
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 500));

    // Take screenshot
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 85,
      fullPage: fullPage,
      clip: fullPage
        ? undefined
        : { x: 0, y: 0, width: Math.min(width, 1366), height: Math.min(height, 2000) },
    });

    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'X-Cache': 'MISS',
    });

    res.send(screenshot);
  } catch (err) {
    console.error('Screenshot error:', err.message);
    
    // Try fallback with simpler approach
    try {
      if (page) {
        await page.goto(url, { waitUntil: 'load', timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000));
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 });
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(screenshot);
      }
    } catch (fallbackErr) {
      console.error('Fallback screenshot error:', fallbackErr.message);
    }

    res.status(502).json({
      status: 'error',
      message: 'Failed to take screenshot: ' + err.message,
    });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /video — Detect video URL on a page
   ══════════════════════════════════════════════════════════ */
app.get('/video', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({
      status: 'error',
      message: 'Missing "url" query parameter',
    });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid URL provided',
    });
  }

  const waitFor = parseInt(req.query.waitFor) || 5000;

  let page = null;
  try {
    page = await createPage(req.query.userAgent);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    // Wait for content to render
    await new Promise(r => setTimeout(r, waitFor));

    // Detect video elements
    const videoData = await page.evaluate(() => {
      const results = [];

      // Check for HTML5 video elements
      document.querySelectorAll('video').forEach((v, i) => {
        // Check for src attribute
        if (v.src && v.src.startsWith('http')) {
          results.push({
            type: 'html5_video',
            url: v.src,
            width: v.videoWidth,
            height: v.videoHeight,
            duration: v.duration || null,
          });
        }
        // Check for source elements inside video
        v.querySelectorAll('source').forEach((s) => {
          if (s.src && s.src.startsWith('http')) {
            results.push({
              type: 'html5_source',
              url: s.src,
              mimeType: s.type || null,
            });
          }
        });
      });

      // Check for video in iframes
      document.querySelectorAll('iframe').forEach((iframe) => {
        const src = iframe.src || iframe.getAttribute('data-src') || '';
        if (
          src.includes('facebook.com/plugins/video') ||
          src.includes('facebook.com/video') ||
          src.includes('fb.watch') ||
          src.includes('youtube.com/embed') ||
          src.includes('player.vimeo.com')
        ) {
          results.push({
            type: 'embed',
            url: src,
          });
        }
      });

      // Check for og:video meta tag
      const ogVideo = document.querySelector('meta[property="og:video"]') ||
                      document.querySelector('meta[property="og:video:url"]');
      if (ogVideo && ogVideo.content) {
        results.push({
          type: 'og_video',
          url: ogVideo.content,
        });
      }

      // Check for Facebook-specific video data
      const fbVideoData = document.querySelector('[data-video-length]') ||
                          document.querySelector('[data-video-id]');
      if (fbVideoData) {
        const videoId = fbVideoData.getAttribute('data-video-id') ||
                        fbVideoData.dataset.videoId ||
                        null;
        if (videoId) {
          results.push({
            type: 'facebook_video',
            url: `https://www.facebook.com/watch/?v=${videoId}`,
            videoId: videoId,
          });
        }
      }

      return results;
    });

    // Extract the best video URL
    let videoUrl = null;
    
    // Preference: HTML5 video with actual source > og:video > embed
    const html5Videos = videoData.filter(v => v.type === 'html5_video' || v.type === 'html5_source');
    const ogVideos = videoData.filter(v => v.type === 'og_video');
    const embeds = videoData.filter(v => v.type === 'embed');

    if (html5Videos.length > 0) {
      videoUrl = html5Videos[0].url;
    } else if (ogVideos.length > 0) {
      videoUrl = ogVideos[0].url;
    } else if (embeds.length > 0) {
      videoUrl = embeds[0].url;
    }

    res.json({
      status: 'success',
      data: {
        video: videoUrl ? { url: videoUrl } : null,
        videos: videoData,
        page: {
          url: url,
          title: await page.title().catch(() => ''),
        },
      },
    });
  } catch (err) {
    console.error('Video detection error:', err.message);

    // Don't fail entirely — return null video
    res.json({
      status: 'success',
      data: {
        video: null,
        videos: [],
        page: { url: url },
      },
    });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET / — Get the video URL only (compatible mode)
   Same as /video but returns { video: url } only
   ══════════════════════════════════════════════════════════ */
app.get('/api/video', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ video: null });

  try {
    // Forward to /video endpoint logic but extract just the video field
    const page = await createPage(req.query.userAgent);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, parseInt(req.query.waitFor) || 5000));

    const videoUrl = await page.evaluate(() => {
      const v = document.querySelector('video[src]');
      return v ? v.src : null;
    });

    await page.close().catch(() => {});
    res.json({ video: videoUrl });
  } catch {
    res.json({ video: null });
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /health — Health check
   ══════════════════════════════════════════════════════════ */
app.get('/health', async (req, res) => {
  const status = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    browser: browser ? (browser.isConnected() ? 'connected' : 'disconnected') : 'not_initialized',
  };

  // Test browser
  if (status.browser !== 'connected') {
    try {
      await getBrowser();
      status.browser = 'reconnected';
    } catch (err) {
      status.browser = 'error: ' + err.message;
      status.status = 'degraded';
    }
  }

  res.json(status);
});

/* ══════════════════════════════════════════════════════════
   Graceful shutdown
   ══════════════════════════════════════════════════════════ */
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(0);
});

/* ── Start server ───────────────────────────────────────── */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`AdSpy Media API running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET /screenshot?url=...&width=500&height=700&waitFor=3000`);
  console.log(`  GET /video?url=...&waitFor=5000`);
  console.log(`  GET /api/video?url=...`);
  console.log(`  GET /health`);
});
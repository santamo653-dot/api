const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  
  const launchArgs = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--disable-accelerated-2d-canvas', '--single-process',
    '--no-first-run', '--no-zygote', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-breakpad', '--disable-client-side-phishing-detection',
    '--disable-component-update', '--disable-default-apps', '--disable-domain-reliability',
    '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
    '--disable-hang-monitor', '--disable-ipc-flooding-protection', '--disable-popup-blocking',
    '--disable-prompt-on-repost', '--disable-renderer-backgrounding', '--disable-sync',
    '--disable-web-resource', '--force-color-profile=srgb', '--metrics-recording-only',
    '--mute-audio', '--no-categories', '--no-default-shm-cache-size', '--no-pings',
    '--password-store=basic', '--use-gl=swiftshader', '--use-mock-keychain',
    '--disable-blink-features=AutomationControlled',
  ];

  browser = await puppeteer.launch({
    headless: 'new',
    args: launchArgs,
    timeout: 60000,
  });

  browser.on('disconnected', () => { browser = null; });
  return browser;
}

async function createPage() {
  const br = await getBrowser();
  const page = await br.newPage();
  
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Realistic user agent to avoid Facebook blocking
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  );

  // Set extra headers to look like a real browser
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  });

  // Bypass webdriver detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] });
  });

  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(30000);

  return page;
}

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /screenshot — Take screenshot of Facebook ad
   ══════════════════════════════════════════════════════════ */
app.get('/screenshot', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });
  
  try { new URL(url); } catch { return res.status(400).json({ status: 'error', message: 'Invalid URL' }); }

  const waitFor = parseInt(req.query.waitFor) || 8000;

  let page = null;
  try {
    page = await createPage();
    
    // Intercept network requests to capture video URLs and images
    const videoUrls = [];
    const imageUrls = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => req.continue());
    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] || '';
      const rUrl = response.url();
      if (ct.startsWith('video/') || rUrl.includes('.mp4') || rUrl.includes('.webm')) {
        videoUrls.push(rUrl);
      }
      if (ct.startsWith('image/') && !rUrl.includes('static.xx.fbcdn')) {
        imageUrls.push(rUrl);
      }
    });

    // Navigate with timeout
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      // Continue anyway, page might be partially loaded
    }

    // Wait additional time for JavaScript rendering
    console.log('Waiting', waitFor, 'ms for content to render...');
    await new Promise(r => setTimeout(r, waitFor));

    // Try to find the ad content - scroll and wait for images
    try {
      await page.evaluate(() => {
        // Scroll to trigger lazy loading
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await new Promise(r => setTimeout(r, 2000));
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(r => setTimeout(r, 2000));
      await page.evaluate(() => { window.scrollTo(0, 0); });
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {}

    // Wait for any images to load
    try {
      await page.waitForSelector('img', { timeout: 5000 }).catch(() => {});
    } catch (e) {}

    // Take full page screenshot
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: true,
    });

    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'X-Cache': 'MISS',
    });
    res.send(screenshot);

  } catch (err) {
    console.error('Screenshot error:', err.message);
    // Convert error to JSON response
    res.status(502).json({
      status: 'error',
      message: 'Screenshot failed: ' + err.message,
      video: null,
      images: [],
    });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /media — Extract ALL media from Facebook ad
   Returns: { screenshot (base64), video_url, images[] }
   ══════════════════════════════════════════════════════════ */
app.get('/media', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });
  
  try { new URL(url); } catch { return res.status(400).json({ status: 'error', message: 'Invalid URL' }); }

  const waitFor = parseInt(req.query.waitFor) || 8000;

  let page = null;
  const result = { video: null, images: [], screenshot: null, pageTitle: '' };
  
  try {
    page = await createPage();
    
    const videoUrls = new Set();
    const imageUrls = new Set();

    await page.setRequestInterception(true);
    page.on('request', (req) => req.continue());
    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] || '';
      const rUrl = response.url();
      if (ct.startsWith('video/') || /\.(mp4|webm|m3u8|ts)(\?|$)/i.test(rUrl)) {
        videoUrls.add(rUrl);
      }
      if (ct.startsWith('image/') && !rUrl.includes('static.xx.fbcdn') && !rUrl.includes('emoji')) {
        imageUrls.add(rUrl);
      }
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {}

    console.log('Waiting for content...');
    await new Promise(r => setTimeout(r, waitFor));

    // Scroll to trigger lazy loading
    try {
      await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
      await new Promise(r => setTimeout(r, 2000));
      await page.evaluate(() => { window.scrollTo(0, 0); });
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {}

    // Extract video and image URLs from the page
    const pageData = await page.evaluate(() => {
      const videoSrcs = [];
      const imgSrcs = [];
      const seen = new Set();

      // Collect all video elements
      document.querySelectorAll('video[src], video source[src]').forEach(el => {
        const src = el.src || el.getAttribute('src');
        if (src && !seen.has(src)) { seen.add(src); videoSrcs.push(src); }
      });

      // Collect all images
      document.querySelectorAll('img[src]').forEach(img => {
        const src = img.src;
        if (src && !seen.has(src) && src.startsWith('http') && !src.includes('static.xx.fbcdn')) {
          seen.add(src); imgSrcs.push(src);
        }
      });

      // Check og:image and og:video meta tags
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg && ogImg.content && !seen.has(ogImg.content)) { seen.add(ogImg.content); imgSrcs.push(ogImg.content); }
      
      const ogVideo = document.querySelector('meta[property="og:video"]') || document.querySelector('meta[property="og:video:url"]');
      if (ogVideo && ogVideo.content && !seen.has(ogVideo.content)) { seen.add(ogVideo.content); videoSrcs.push(ogVideo.content); }

      // Check for JSON-LD video data
      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try {
          const data = JSON.parse(script.textContent);
          const json = JSON.stringify(data);
          // Find video URLs in JSON
          const matches = json.match(/"contentUrl"\s*:\s*"([^"]+)"/);
          if (matches && !seen.has(matches[1])) { seen.add(matches[1]); videoSrcs.push(matches[1]); }
        } catch(e) {}
      });

      // Check for fb:video meta
      const fbVideo = document.querySelector('meta[property="fb:video"]');
      if (fbVideo && fbVideo.content && !seen.has(fbVideo.content)) { seen.add(fbVideo.content); videoSrcs.push(fbVideo.content); }

      return { videoSrcs, imgSrcs };
    });

    // Merge network-captured with DOM-captured
    const allVideos = [...new Set([...videoUrls, ...pageData.videoSrcs])];
    const allImages = [...new Set([...imageUrls, ...pageData.imgSrcs])];

    // Filter only valid URLs
    result.video = allVideos.length > 0 ? allVideos[0] : null;
    result.images = allImages.slice(0, 20); // limit to 20 images
    result.pageTitle = await page.title().catch(() => '');

    // Take screenshot if we found images or video
    if (allImages.length > 0 || allVideos.length > 0) {
      try {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: true });
        result.screenshot = 'data:image/jpeg;base64,' + screenshot.toString('base64');
      } catch (e) {}
    }

    res.json({ status: 'success', data: result });

  } catch (err) {
    console.error('Media extraction error:', err.message);
    res.json({ status: 'success', data: result });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /api/video — Simplified video detection
   ══════════════════════════════════════════════════════════ */
app.get('/api/video', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ video: null });

  let page = null;
  try {
    page = await createPage();
    const videoUrls = new Set();

    await page.setRequestInterception(true);
    page.on('request', (req) => req.continue());
    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] || '';
      const rUrl = response.url();
      if (ct.startsWith('video/') || /\.(mp4|webm|m3u8|ts)(\?|$)/i.test(rUrl)) {
        videoUrls.add(rUrl);
      }
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {}
    
    await new Promise(r => setTimeout(r, parseInt(req.query.waitFor) || 8000));

    // Scroll to trigger video loading
    try {
      await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
      await new Promise(r => setTimeout(r, 2000));
      await page.evaluate(() => { window.scrollTo(0, 0); });
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {}

    // Also check DOM
    const domVideo = await page.evaluate(() => {
      const v = document.querySelector('video[src]');
      if (v && v.src && v.src.startsWith('http')) return v.src;
      const source = document.querySelector('video source[src]');
      if (source && source.src && source.src.startsWith('http')) return source.src;
      const ogVideo = document.querySelector('meta[property="og:video"]') || document.querySelector('meta[property="og:video:url"]');
      if (ogVideo && ogVideo.content) return ogVideo.content;
      return null;
    });

    const allVideos = [...new Set([...videoUrls, ...(domVideo ? [domVideo] : [])])];
    
    await page.close().catch(() => {});
    res.json({ video: allVideos.length > 0 ? allVideos[0] : null });

  } catch {
    res.json({ video: null });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /health
   ══════════════════════════════════════════════════════════ */
app.get('/health', async (req, res) => {
  const status = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    browser: browser ? (browser.isConnected() ? 'connected' : 'disconnected') : 'not_initialized',
  };
  if (status.browser !== 'connected') {
    try { await getBrowser(); status.browser = 'reconnected'; }
    catch (err) { status.browser = 'error: ' + err.message; status.status = 'degraded'; }
  }
  res.json(status);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});

app.listen(parseInt(process.env.PORT || '3000', 10), '0.0.0.0', () => {
  console.log('AdSpy Media API v2 running');
  console.log('GET /screenshot?url=...&waitFor=8000');
  console.log('GET /media?url=...&waitFor=8000  (recommended - returns video + images + screenshot)');
  console.log('GET /api/video?url=...');
  console.log('GET /health');
});
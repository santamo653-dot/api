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
    '--window-size=1920,1080',
  ];

  browser = await puppeteer.launch({
    headless: 'new',
    args: launchArgs,
    timeout: 60000,
    ignoreHTTPSErrors: true,
  });

  browser.on('disconnected', () => { browser = null; });
  return browser;
}

async function createPage() {
  const br = await getBrowser();
  const page = await br.newPage();
  
  // Set realistic viewport
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Use a very realistic Chrome user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
  });

  // Massive stealth: override ALL detection methods
  await page.evaluateOnNewDocument(() => {
    // Override navigator properties
    const newProto = navigator.__proto__;
    delete newProto.webdriver;
    Object.defineProperty(newProto, 'webdriver', { get: () => undefined });
    
    // Add plugins
    Object.defineProperty(navigator, 'plugins', { 
      get: () => [1, 2, 3, 4, 5].map(i => ({ name: `Plugin ${i}`, filename: `plugin${i}.dll` }))
    });
    
    // Add languages
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
    
    // Override chrome
    window.chrome = { runtime: {} };
    
    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    // Override webdriver detection
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
    document.hasFocus = () => true;
  });

  page.setDefaultNavigationTimeout(35000);
  page.setDefaultTimeout(35000);

  return page;
}

async function navigateAndWait(page, url, waitMs) {
  console.log('Navigating to:', url.substring(0, 80) + '...');
  
  // Try multiple navigation strategies
  const strategies = [
    { waitUntil: 'domcontentloaded', timeout: 20000 },
    { waitUntil: 'networkidle2', timeout: 30000 },
    { waitUntil: 'load', timeout: 20000 },
  ];

  let success = false;
  for (const s of strategies) {
    try {
      await page.goto(url, s);
      success = true;
      console.log('Navigation succeeded with:', s.waitUntil);
      break;
    } catch (e) {
      console.log('Navigation failed with', s.waitUntil, ':', e.message.substring(0, 50));
    }
  }

  // Wait for JavaScript to execute
  console.log('Waiting', waitMs, 'ms for content...');
  await new Promise(r => setTimeout(r, waitMs));

  // Scroll to trigger lazy loading
  try {
    for (let i = 1; i <= 3; i++) {
      await page.evaluate((s) => window.scrollTo(0, document.body.scrollHeight * s / 3), i);
      await new Promise(r => setTimeout(r, 1000));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {}

  return success;
}

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /screenshot
   ══════════════════════════════════════════════════════════ */
app.get('/screenshot', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });
  try { new URL(url); } catch { return res.status(400).json({ status: 'error', message: 'Invalid URL' }); }

  let page = null;
  try {
    page = await createPage();
    await navigateAndWait(page, url, parseInt(req.query.waitFor) || 8000);

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: true });
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    res.send(screenshot);

  } catch (err) {
    console.error('Screenshot error:', err.message);
    res.status(502).json({ status: 'error', message: 'Screenshot failed: ' + err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /media — Extract ALL media (video + images + screenshot)
   ══════════════════════════════════════════════════════════ */
app.get('/media', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });
  try { new URL(url); } catch { return res.status(400).json({ status: 'error', message: 'Invalid URL' }); }

  let page = null;
  const result = { video: null, images: [], screenshot: null, pageTitle: '' };
  
  try {
    page = await createPage();
    
    // Intercept network for video/image URLs
    const videoUrls = new Set();
    const imageUrls = new Set();

    await page.setRequestInterception(true);
    page.on('request', (req) => req.continue());
    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] || '';
      const rUrl = response.url();
      if (ct.startsWith('video/') || /\.(mp4|webm|m3u8|ts)(\?|$)/i.test(rUrl)) {
        videoUrls.add(rUrl);
        console.log('Found video:', rUrl.substring(0, 80));
      }
      if (ct.startsWith('image/') && rUrl.includes('fbcdn.net') && !rUrl.includes('emoji')) {
        imageUrls.add(rUrl);
      }
    });

    await navigateAndWait(page, url, parseInt(req.query.waitFor) || 8000);

    // Extract media from DOM
    const pageData = await page.evaluate(() => {
      const vids = [], imgs = [], seen = new Set();

      document.querySelectorAll('video[src], video source[src], video source[data-src]').forEach(el => {
        const src = el.src || el.getAttribute('src') || el.getAttribute('data-src');
        if (src && src.startsWith('http') && !seen.has(src)) { seen.add(src); vids.push(src); }
      });

      document.querySelectorAll('img[src], img[data-src]').forEach(img => {
        const src = img.src || img.getAttribute('src') || img.getAttribute('data-src');
        if (src && src.startsWith('http') && !seen.has(src) && (src.includes('fbcdn') || src.includes('cdninstagram'))) {
          seen.add(src); imgs.push(src);
        }
      });

      // Meta tags
      ['og:image', 'og:video', 'og:video:url', 'fb:video'].forEach(prop => {
        const el = document.querySelector(`meta[property="${prop}"]`);
        if (el && el.content && !seen.has(el.content)) { seen.add(el.content); 
          if (prop.includes('image')) imgs.push(el.content);
          else vids.push(el.content);
        }
      });

      // JSON-LD
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
          const data = JSON.parse(s.textContent);
          const json = JSON.stringify(data);
          const matches = json.match(/"contentUrl"\s*:\s*"([^"]+)"/);
          if (matches && !seen.has(matches[1])) { seen.add(matches[1]); vids.push(matches[1]); }
        } catch(e) {}
      });

      return { videos: vids, images: imgs };
    });

    // Merge network + DOM
    const allVideos = [...new Set([...videoUrls, ...pageData.videos])];
    const allImages = [...new Set([...imageUrls, ...pageData.images])];

    result.video = allVideos.length > 0 ? allVideos[0] : null;
    result.images = allImages.slice(0, 20);
    result.pageTitle = await page.title().catch(() => '');

    // Take screenshot
    if (allImages.length > 0 || allVideos.length > 0) {
      try {
        const ss = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: true });
        result.screenshot = 'data:image/jpeg;base64,' + ss.toString('base64');
      } catch(e) {}
    }

    res.json({ status: 'success', data: result });

  } catch (err) {
    console.error('Media error:', err.message);
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

    await navigateAndWait(page, url, parseInt(req.query.waitFor) || 8000);

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
  console.log('AdSpy Media API v3 running');
  console.log('GET /screenshot?url=...');
  console.log('GET /media?url=...  (video + images + screenshot)');
  console.log('GET /api/video?url=...');
  console.log('GET /health');
});
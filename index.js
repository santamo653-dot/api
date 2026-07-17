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
  
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-accelerated-2d-canvas', '--single-process',
      '--no-first-run', '--disable-background-networking',
      '--disable-background-timer-throttling', '--disable-breakpad',
      '--disable-component-update', '--disable-default-apps',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-hang-monitor', '--disable-ipc-flooding-protection',
      '--disable-popup-blocking', '--disable-renderer-backgrounding', '--disable-sync',
      '--disable-blink-features=AutomationControlled',
      '--window-size=375,812',  // iPhone viewport
    ],
    timeout: 60000,
    ignoreHTTPSErrors: true,
  });

  browser.on('disconnected', () => { browser = null; });
  return browser;
}

async function createPage() {
  const br = await getBrowser();
  const page = await br.newPage();
  
  // **MOBILE VIEWPORT** - Facebook ads are optimized for mobile
  await page.setViewport({ 
    width: 375, 
    height: 812, 
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  
  // Realistic mobile user agent
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  );

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'fr-FR,fr;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  });

  // Stealth mode
  await page.evaluateOnNewDocument(() => {
    const newProto = navigator.__proto__;
    delete newProto.webdriver;
    Object.defineProperty(newProto, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { 
      get: () => [1, 2, 3, 4, 5].map(i => ({ name: `Plugin ${i}`, filename: `plugin${i}.dll` }))
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  page.setDefaultNavigationTimeout(35000);
  page.setDefaultTimeout(35000);

  return page;
}

async function navigateAndWait(page, url, waitMs) {
  console.log('Navigating to:', url.substring(0, 80) + '...');
  
  const strategies = [
    { waitUntil: 'domcontentloaded', timeout: 20000 },
    { waitUntil: 'networkidle2', timeout: 30000 },
    { waitUntil: 'load', timeout: 20000 },
  ];

  for (const s of strategies) {
    try {
      await page.goto(url, s);
      console.log('Navigation succeeded with:', s.waitUntil);
      break;
    } catch (e) {
      console.log('Navigation failed with', s.waitUntil, ':', e.message.substring(0, 50));
    }
  }

  console.log('Waiting', waitMs, 'ms for content...');
  await new Promise(r => setTimeout(r, waitMs));

  return true;
}

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /screenshot — Mobile viewport screenshot
   ══════════════════════════════════════════════════════════ */
app.get('/screenshot', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });
  try { new URL(url); } catch { return res.status(400).json({ status: 'error', message: 'Invalid URL' }); }

  let page = null;
  try {
    page = await createPage();
    await navigateAndWait(page, url, parseInt(req.query.waitFor) || 8000);

    // Screenshot at mobile viewport - this will show the ad as it appears on phone
    const screenshot = await page.screenshot({ 
      type: 'jpeg', 
      quality: 85,
      fullPage: false,  // Just the viewport
    });

    res.set({ 
      'Content-Type': 'image/jpeg', 
      'Cache-Control': 'public, max-age=86400',
      'Content-Length': screenshot.length,
    });
    res.send(screenshot);

  } catch (err) {
    console.error('Screenshot error:', err.message);
    res.status(502).json({ status: 'error', message: 'Screenshot failed: ' + err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /api/video — Get video URL from Facebook ad
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
    version: 'v7-mobile-viewport',
    browser: browser ? (browser.isConnected() ? 'connected' : 'disconnected') : 'not_initialized',
    viewport: '375x812 (iPhone)',
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
  console.log('AdSpy Media API v7 running (iPhone viewport)');
  console.log('GET /screenshot?url=...  (375x812 screenshot)');
  console.log('GET /api/video?url=...   (extracts video)');
  console.log('GET /health');
});
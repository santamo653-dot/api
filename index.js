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

const FB_TOKEN = process.env.FB_TOKEN || 'EAAgafcLWzhIBRZB93cule4CtDJgR2l2IYIL9jHKafZC8DPOOmmnMGVSHVQuZBB8LRu25Rxx9smaKdIpA2La9xCFNPQvfybxh6ndxEUVfgcpxyU55YBvvmX0RKTehCfiipVzxr5um99KgiofgzrTEQEnZAnwD4D7rYfRZCyOahdqu4PIPz0uIOItapeZBOsD8spLy1XMrkIIuz2sHZC7lUR59LYgmGOzP49eH4HVWDSKCYGO70NkZBDTwTtsveGQdnRJ9zlxheMYMoNuOI1ZBgTdZBhVdPx';

function getBaseUrl(req) {
  // Railway terminates TLS, req.protocol returns 'http' behind proxy
  return 'https://' + req.get('host');
}

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /screenshot
   ══════════════════════════════════════════════════════════ */
app.get('/screenshot', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url' });
  try { new URL(url); } catch { return res.status(400).json({ status: 'error', message: 'Invalid URL' }); }

  try {
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
    const ogImgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImgMatch) return await serveImage(res, ogImgMatch[1]);

    const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    const fbcdnImages = imgMatches
      .map(m => m[1])
      .filter(src => src.includes('fbcdn.net') || src.includes('cdninstagram.com'))
      .filter(src => !src.includes('emoji') && !src.includes('icon'))
      .map(src => src.replace(/\/s\d+x\d+\//, '/s1080x1080/').replace(/[\/?&]oh=[^&]+/g, '').replace(/[\/?&]oe=[^&]+/g, '').replace(/[\/?&]s=\d+/g, ''));
    if (fbcdnImages.length > 0) return await serveImage(res, fbcdnImages[0]);

    const videoPosterMatch = html.match(/poster=["']([^"']+)["']/i);
    if (videoPosterMatch) return await serveImage(res, videoPosterMatch[1]);

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
    const response = await axios.get(url, { timeout: 20000, httpAgent, httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'fr-FR,fr;q=0.9', 'Referer': 'https://www.facebook.com/' }, responseType: 'text' });
    const html = response.data;
    const patterns = [/"playable_url"\s*:\s*"([^"]+)"/, /"browser_native_hd_url"\s*:\s*"([^"]+)"/, /"browser_native_sd_url"\s*:\s*"([^"]+)"/, /"hd_src"\s*:\s*"([^"]+)"/, /"sd_src"\s*:\s*"([^"]+)"/, /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i, /"video_url"\s*:\s*"([^"]+)"/];
    for (const p of patterns) { const m = html.match(p); if (m) return res.json({ video: m[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/') }); }
    res.json({ video: null });
  } catch { res.json({ video: null }); }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /media
   ══════════════════════════════════════════════════════════ */
app.get('/media', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ data: { video: null, images: [] } });
  try {
    try { new URL(url); } catch { return res.json({ data: { video: null, images: [] } }); }
    const r = await axios.get(url, { timeout: 20000, httpAgent, httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8', 'Referer': 'https://www.facebook.com/' }, responseType: 'text', maxRedirects: 5 });
    const html = r.data;
    const images = [];
    const ogImgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImgMatch?.[1]) images.push(ogImgMatch[1]);
    const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    const fbcdn = imgMatches.map(m => m[1]).filter(s => (s.includes('fbcdn.net') || s.includes('cdninstagram.com')) && !s.includes('emoji') && !s.includes('icon')).map(s => s.replace(/\/s\d+x\d+\//, '/s1080x1080/').replace(/[\/?&]oh=[^&]+/g, '').replace(/[\/?&]oe=[^&]+/g, '').replace(/[\/?&]s=\d+/g, ''));
    for (const u of fbcdn) { if (images.length >= 5) break; if (!images.includes(u)) images.push(u); }
    if (images.length === 0) { const vp = html.match(/poster=["']([^"']+)["']/i); if (vp?.[1]) images.push(vp[1]); }
    const patterns = [/"playable_url"\s*:\s*"([^"]+)"/, /"browser_native_hd_url"\s*:\s*"([^"]+)"/, /"browser_native_sd_url"\s*:\s*"([^"]+)"/, /"hd_src"\s*:\s*"([^"]+)"/, /"sd_src"\s*:\s*"([^"]+)"/, /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i, /"video_url"\s*:\s*"([^"]+)"/];
    let video = null;
    for (const p of patterns) { const m = html.match(p); if (m) { video = m[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/'); break; } }
    res.json({ data: { video, images } });
  } catch { res.json({ data: { video: null, images: [] } }); }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /proxy-image
   ══════════════════════════════════════════════════════════ */
app.get('/proxy-image', async (req, res) => {
  const imgUrl = req.query.url;
  if (!imgUrl || !/^https:\/\//i.test(imgUrl)) return res.status(400).end();
  try {
    const r = await axios.get(imgUrl, { timeout: 15000, httpAgent, httpsAgent, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.facebook.com/', 'Accept': 'image/webp,image/*,*/*;q=0.8' } });
    res.set('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(r.data);
  } catch { res.status(404).end(); }
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /view
   Full ad viewer with screenshot / iframe / media tabs
   ══════════════════════════════════════════════════════════ */
app.get('/view', async (req, res) => {
  const adUrl = req.query.url || '';
  const adId = req.query.id || '';
  const snapUrl = adUrl || (adId ? 'https://www.facebook.com/ads/archive/render_ad/?id=' + adId : '');
  
  if (!snapUrl) {
    return res.send('<!DOCTYPE html><html><body style="font-family:sans-serif;background:#07090f;color:#e4e6f0;padding:40px"><h2>📡 AdSpy - View Ad Media</h2><form method="get"><input type="text" name="url" placeholder="Facebook Ad URL" style="width:80%;padding:10px;font-size:14px;background:#111827;border:1px solid #2a3050;color:#e4e6f0;border-radius:8px"><button type="submit" style="padding:10px 20px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;margin-left:10px">View</button></form><p style="margin-top:20px;color:#6b7280">Or use <code>?id=AD_ID</code></p></body></html>');
  }
  
  const BASE = getBaseUrl(req);
  const encoded = encodeURIComponent(snapUrl);
  
  res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Ad Media</title><script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script><style>body{font-family:sans-serif;background:#07090f;color:#e4e6f0;margin:0;padding:20px;text-align:center}h1{font-size:18px;margin-bottom:20px}.media-box{background:#0f1420;border:1px solid #1e2235;border-radius:16px;padding:20px;max-width:800px;margin:0 auto 20px}.media-box img{max-width:100%;border-radius:8px;display:block;margin:0 auto}.media-box video{max-width:100%;border-radius:8px}.links{margin-top:20px}a{display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;margin:5px}.iframe-box{background:#0f1420;border:1px solid #1e2235;border-radius:16px;overflow:hidden}.iframe-box iframe{width:100%;height:600px;border:none}.tabs{display:flex;gap:10px;justify-content:center;margin-bottom:20px}.tab{padding:8px 16px;border-radius:8px;cursor:pointer;border:1px solid #2a3050;background:#111827;color:#9ca3af;font-size:13px}.tab.on{background:#4f46e5;color:#fff;border-color:#4f46e5}.spinner{width:36px;height:36px;border:3px solid #1e2235;border-top-color:#818cf8;border-radius:50%;animation:spin .8s linear infinite;margin:20px auto}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div id="app"><h1>📡 Ad Media Viewer</h1><div class="tabs"><div class="tab" :class="{on:tab===\'screenshot\'}" @click="tab=\'screenshot\'">📸 Screenshot</div><div class="tab" :class="{on:tab===\'iframe\'}" @click="tab=\'iframe\'">🖼 Facebook Iframe</div><div class="tab" :class="{on:tab===\'media\'}" @click="tab=\'media\';fetchMedia()">🎬 Media</div></div><div class="media-box" v-if="tab===\'screenshot\'"><img :src="\'' + BASE + '/screenshot?url=' + encoded + '&waitFor=3000\'" alt="Screenshot" onerror="this.outerHTML=\'<p style=color:#fca5a5>Not available</p>\'"></div><div class="iframe-box" v-if="tab===\'iframe\'"><iframe src="' + snapUrl.replace(/"/g, '"') + '" allowfullscreen></iframe></div><div class="media-box" v-if="tab===\'media\'"><div v-if="loading"><div class="spinner"></div></div><div v-if="videoUrl"><video :src="videoUrl" controls autoplay muted style="width:100%"></video><p style="color:#818cf8;margin-top:10px">✅ Video</p></div><div v-if="images.length"><img v-for="img in images" :src="\'' + BASE + '/proxy-image?url=\'+encodeURIComponent(img)" style="max-width:100%;margin:10px 0;border-radius:8px" @error="$event.target.style.display=\'none\'"></div><p v-if="!loading&&!videoUrl&&!images.length" style="color:#6b7280">No media</p></div><div class="links"><a href="' + snapUrl.replace(/"/g, '"') + '" target="_blank">↗ Facebook</a><a href="' + BASE + '/screenshot?url=' + encoded + '" target="_blank">📸 Direct</a></div></div><script>const{createApp,ref}=Vue;createApp({setup(){const tab=ref(\'screenshot\');const loading=ref(false);const videoUrl=ref(null);const images=ref([]);const snapUrl=\'' + snapUrl.replace(/'/g, "\\'") + '\';async function fetchMedia(){loading.value=true;try{const json=await(await fetch(\'' + BASE + '/media?url=' + encodeURIComponent(snapUrl) + '\')).json();videoUrl.value=json?.data?.video||json?.video||null;images.value=json?.data?.images||json?.images||[]}catch(e){}loading.value=false}return{tab,loading,videoUrl,images,snapUrl,fetchMedia}}).mount(\'#app\');</script></body></html>');
});

/* ══════════════════════════════════════════════════════════
   ENDPOINT: GET /health
   ══════════════════════════════════════════════════════════ */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now(), version: 'v8-no-puppeteer' });
});

async function serveImage(res, imgUrl) {
  try {
    const imgResponse = await axios.get(imgUrl, { timeout: 15000, httpAgent, httpsAgent, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8', 'Referer': 'https://www.facebook.com/' }, maxRedirects: 5 });
    const ct = imgResponse.headers['content-type'] || 'image/jpeg';
    res.set({ 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400', 'Content-Length': imgResponse.data.length });
    res.send(imgResponse.data);
  } catch (err) {
    console.error('Failed to fetch image:', err.message);
    res.status(502).json({ status: 'error', message: 'Failed: ' + err.message });
  }
}

app.listen(parseInt(process.env.PORT || '3000', 10), '0.0.0.0', () => {
  console.log('AdSpy Media API v8 running');
  console.log('  /screenshot?url=...  /media?url=...  /api/video?url=...');
  console.log('  /proxy-image?url=...  /view?url=...  /health');
});
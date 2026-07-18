import os
import json
from flask import Flask, request, jsonify, send_file, render_template_string
from playwright.sync_api import sync_playwright
import io
import tempfile
import time
from urllib.parse import quote

app = Flask(__name__)

PORT = int(os.environ.get('PORT', 3000))
FB_TOKEN = os.environ.get('FB_TOKEN', 'EAAgafcLWzhIBRZB93cule4CtDJgR2l2IYIL9jHKafZC8DPOOmmnMGVSHVQuZBB8LRu25Rxx9smaKdIpA2La9xCFNPQvfybxh6ndxEUVfgcpxyU55YBvvmX0RKTehCfiipVzxr5um99KgiofgzrTEQEnZAnwD4D7rYfRZCyOahdqu4PIPz0uIOItapeZBOsD8spLy1XMrkIIuz2sHZC7lUR59LYgmGOzP49eH4HVWDSKCYGO70NkZBDTwTtsveGQdnRJ9zlxheMYMoNuOI1ZBgTdZBhVdPx')

browser = None

def get_browser():
    global browser
    if browser and browser.is_connected():
        return browser
    p = sync_playwright().start()
    browser = p.chromium.launch(
        headless=True,
        args=[
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--disable-gpu',
            '--no-zygote',
        ]
    )
    return browser

@app.route('/screenshot', methods=['GET'])
def screenshot():
    url = request.args.get('url', '')
    if not url:
        return jsonify({'status': 'error', 'message': 'Missing url'}), 400
    
    width = int(request.args.get('width', 500))
    height = int(request.args.get('height', 700))
    wait_for = int(request.args.get('waitFor', 5000))
    
    try:
        br = get_browser()
        page = br.new_page()
        page.set_viewport_size({'width': width, 'height': height})
        page.set_extra_http_headers({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'fr-FR,fr;q=0.9',
        })
        
        page.goto(url, wait_until='networkidle', timeout=30000)
        time.sleep(wait_for / 1000)
        
        screenshot_bytes = page.screenshot(type='png')
        page.close()
        
        img_io = io.BytesIO(screenshot_bytes)
        return send_file(img_io, mimetype='image/png', as_attachment=False, download_name='screenshot.png')
    
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 502

@app.route('/media', methods=['GET'])
def media():
    url = request.args.get('url', '')
    if not url:
        return jsonify({'data': {'video': None, 'images': []}})
    
    wait_for = int(request.args.get('waitFor', 5000))
    
    try:
        br = get_browser()
        page = br.new_page()
        page.set_viewport_size({'width': 1366, 'height': 768})
        page.set_extra_http_headers({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'fr-FR,fr;q=0.9',
        })
        
        page.goto(url, wait_until='networkidle', timeout=30000)
        time.sleep(wait_for / 1000)
        
        # Extract media URLs using JavaScript evaluation inside the page
        result = page.evaluate("""() => {
            const unique = arr => [...new Set(arr.filter(x => x && x.startsWith('http')))];
            
            // Images
            const images = [];
            document.querySelectorAll('img').forEach(img => {
                images.push(img.currentSrc || img.src || img.dataset.src || '');
            });
            
            // Videos
            const videos = [];
            document.querySelectorAll('video').forEach(video => {
                videos.push(video.currentSrc || video.src || '');
                video.querySelectorAll('source').forEach(s => videos.push(s.src || ''));
            });
            
            // OG tags
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content) images.unshift(ogImage.content);
            const ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:url"]');
            if (ogVideo && ogVideo.content) videos.unshift(ogVideo.content);
            
            return {images: unique(images), videos: unique(videos)};
        }""")
        
        page.close()
        
        return jsonify({
            'status': 'success',
            'data': {
                'video': result['videos'][0] if result['videos'] else None,
                'images': result['images'],
                'videos': result['videos']
            }
        })
    
    except Exception as e:
        return jsonify({'status': 'success', 'data': {'video': None, 'images': []}})

@app.route('/view', methods=['GET'])
def view():
    ad_url = request.args.get('url', '')
    ad_id = request.args.get('id', '')
    snap_url = ad_url or (f'https://www.facebook.com/ads/archive/render_ad/?id={ad_id}' if ad_id else '')
    
    if not snap_url:
        return render_template_string("""
        <html><body style="font-family:sans-serif;background:#07090f;color:#e4e6f0;padding:40px">
        <h2>📡 AdSpy - View Ad Media</h2>
        <form method="get">
            <input type="text" name="url" placeholder="Facebook Ad URL" style="width:80%;padding:10px;font-size:14px;background:#111827;border:1px solid #2a3050;color:#e4e6f0;border-radius:8px">
            <button type="submit" style="padding:10px 20px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">View</button>
        </form>
        <p>Or use <code>?id=AD_ID</code></p>
        </body></html>
        """)
    
    base = f"https://{request.host}"
    encoded = quote(snap_url)
    
    return render_template_string("""
    <!DOCTYPE html>
    <html><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Ad Media</title>
    <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
    <style>
    body{font-family:sans-serif;background:#07090f;color:#e4e6f0;margin:0;padding:20px;text-align:center}
    h1{font-size:18px;margin-bottom:20px}
    .box{background:#0f1420;border:1px solid #1e2235;border-radius:16px;padding:20px;max-width:800px;margin:0 auto 20px}
    .box img{max-width:100%;border-radius:8px;display:block;margin:0 auto}
    .box video{max-width:100%;border-radius:8px}
    .links{margin-top:20px}
    a{display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;margin:5px}
    .tabs{display:flex;gap:10px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}
    .tab{padding:8px 16px;border-radius:8px;cursor:pointer;border:1px solid #2a3050;background:#111827;color:#9ca3af;font-size:13px}
    .tab.on{background:#4f46e5;color:#fff;border-color:#4f46e5}
    .spinner{width:36px;height:36px;border:3px solid #1e2235;border-top-color:#818cf8;border-radius:50%;animation:spin .8s linear infinite;margin:20px auto}
    @keyframes spin{to{transform:rotate(360deg)}}
    .meta{background:#0d111d;border:1px solid #1e2235;border-radius:12px;padding:15px;margin-top:20px;text-align:left;font-size:13px;color:#9ca3af}
    .meta a{background:none;padding:0;color:#818cf8;font-size:13px;margin:0}
    iframe{width:100%;height:600px;border:none;border-radius:8px}
    </style></head><body>
    <div id="app">
      <h1>📡 Ad Media Viewer</h1>
      <div class="tabs">
        <div class="tab" :class="{on:tab==='screenshot'}" @click="tab='screenshot'">📸 Screenshot</div>
        <div class="tab" :class="{on:tab==='media'}" @click="tab='media';fetchMedia()">🎬 Media</div>
      </div>
      
      <div class="box" v-if="tab==='screenshot'">
        <p style="color:#818cf8;margin-bottom:10px;font-size:13px">Screenshot taken with Playwright browser</p>
        <img :src="screenshotUrl" alt="Screenshot" onerror="this.outerHTML='<p style=color:#fca5a5>Screenshot not available</p>'">
      </div>
      
      <div class="box" v-if="tab==='media'">
        <div v-if="loading"><div class="spinner"></div></div>
        <div v-if="videoUrl">
          <video :src="videoUrl" controls autoplay muted style="width:100%"></video>
          <p style="color:#818cf8;margin-top:10px">✅ Video detected</p>
        </div>
        <div v-if="images.length">
          <img v-for="(img,i) in images" :key="i" :src="img" style="max-width:100%;margin:10px 0;border-radius:8px" @error="$event.target.style.display='none'">
        </div>
        <p v-if="!loading&&!videoUrl&&!images.length" style="color:#6b7280">No media found</p>
      </div>
      
      <div class="links">
        <a :href="snapUrl" target="_blank">↗ Open on Facebook</a>
        <a :href="screenshotUrl" target="_blank">📸 Direct Screenshot</a>
      </div>
      
      <div class="meta">
        📊 <strong>Ad ID:</strong> {{ snapUrl.split('id=')[1] || 'N/A' }}<br>
        🔗 <a :href="snapUrl" target="_blank">{{ snapUrl }}</a>
      </div>
    </div>
    <script>
    const{createApp,ref}=Vue;
    createApp({setup(){
      const tab=ref('screenshot');
      const loading=ref(false);
      const videoUrl=ref(null);
      const images=ref([]);
      const snapUrl=JSON.parse('{{ snap_url | tojson | safe }}');
      const base='{{ base }}';
      const screenshotUrl=base+'/screenshot?url='+encodeURIComponent(snapUrl)+'&waitFor=5000';
      async function fetchMedia(){loading.value=true;try{const j=await(await fetch(base+'/media?url='+encodeURIComponent(snapUrl)+'&waitFor=5000')).json();videoUrl.value=j?.data?.video||j?.video||null;images.value=j?.data?.images||j?.images||[];if(images.length){images.value=images.value.map(img=>base+'/proxy-image?url='+encodeURIComponent(img))}}catch(e){}loading.value=false}
      return{tab,loading,videoUrl,images,snapUrl,screenshotUrl,fetchMedia}
    }}).mount('#app');
    </script>
    </body></html>
    """, base=base, snap_url=snap_url)

@app.route('/proxy-image', methods=['GET'])
def proxy_image():
    img_url = request.args.get('url', '')
    if not img_url or not img_url.startswith('https://'):
        return '', 400
    
    import requests as req
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.facebook.com/',
            'Accept': 'image/webp,image/*,*/*;q=0.8'
        }
        r = req.get(img_url, headers=headers, timeout=15, stream=True)
        if r.status_code == 200:
            ct = r.headers.get('content-type', 'image/jpeg')
            return send_file(io.BytesIO(r.content), mimetype=ct, as_attachment=False)
        return '', 404
    except:
        return '', 404

@app.route('/health')
def health():
    return jsonify({
        'status': 'ok',
        'version': 'v9-playwright-python'
    })

if __name__ == '__main__':
    # Just verify we can launch browser
    print("🚀 AdSpy Media API Python starting...")
    app.run(host='0.0.0.0', port=PORT)
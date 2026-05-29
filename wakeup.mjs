import { chromium } from 'playwright';

const PROJ = {
  name: 'abcdeasdf',
  manageUrl: 'https://abcdeasdf.zo.computer/',
  webuiUrl: 'https://hermes-webui-abcdeasdf.zocomputer.io/',
  cookieDomain: 'abcdeasdf.zo.computer',
  screenshotFile: 'screenshot.png',
};

const ACCESS_TOKEN = process.env.ZO_ACCESS_TOKEN;
const REFRESH_TOKEN = process.env.ZO_REFRESH_TOKEN;

if (!ACCESS_TOKEN || !REFRESH_TOKEN) {
  console.error('Missing ZO_ACCESS_TOKEN or ZO_REFRESH_TOKEN');
  process.exit(1);
}

async function wakeUp() {
  try {
    const res = await fetch(PROJ.manageUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
        'Cookie': `access_token=${ACCESS_TOKEN}; refresh_token=${REFRESH_TOKEN}`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(30000),
    });

    const location = res.headers.get('location') || '';
    const setCookie = res.headers.getSetCookie?.() || [];

    console.log(`response: ${res.status}`);
    console.log(`location: ${location || '(none)'}`);
    console.log(`set-cookie: ${setCookie.length}`);

    if (location.includes('auth.zo.computer') || location.includes('/login') ||
        (location.includes('www.zo.computer') && !location.includes(`handle=${PROJ.name}`))) {
      console.error('REDIRECTED TO LOGIN - auth failed');
      return { success: false, reason: 'login_redirect', location };
    }
    if (res.status >= 200 && res.status < 300) {
      return { success: true, statusCode: res.status, setCookie };
    }
    if (res.status >= 300 && res.status < 400) {
      if (location.includes(`${PROJ.name}.zo.computer`) || location.includes(`handle=${PROJ.name}`)) {
        return { success: true, statusCode: res.status, location };
      }
    }
    return { success: false, reason: `status_${res.status}`, location };
  } catch (e) {
    console.error('fetch error:', e.message);
    return { success: false, reason: 'fetch_error', location: '' };
  }
}

async function checkWebUI() {
  try {
    const res = await fetch(PROJ.webuiUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'keepalive/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

(async () => {
  try {
    console.log('=== step 1: wake up ===');
    const result = await wakeUp();

    if (!result.success) {
      console.error('wake up failed:', result.reason);
      process.exit(1);
    }
    console.log('wake up request sent');

    console.log('=== step 2: wait for webui ===');
    const MAX_WAIT_MS = 120000;
    const CHECK_INTERVAL_MS = 10000;
    const startTime = Date.now();
    let webuiOk = false;

    while (Date.now() - startTime < MAX_WAIT_MS) {
      const status = await checkWebUI();
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`webui check: ${status} (${elapsed}s)`);
      if (status && status >= 200 && status < 300) { console.log('webui is up'); webuiOk = true; break; }
      if (status === 521) console.log('not ready (521)');
      else if (status === 0) console.log('not reachable');
      await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
    }

    if (!webuiOk) { console.log('webui not up within 2min, but request was sent - should start eventually'); }

    console.log('=== step 3: screenshot ===');
    try {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0'
      });
      await context.addCookies([
        { name: 'access_token', value: ACCESS_TOKEN, domain: PROJ.cookieDomain, path: '/', secure: true },
        { name: 'refresh_token', value: REFRESH_TOKEN, domain: PROJ.cookieDomain, path: '/', secure: true },
        { name: 'access_token', value: ACCESS_TOKEN, domain: '.zo.computer', path: '/', secure: true },
        { name: 'refresh_token', value: REFRESH_TOKEN, domain: '.zo.computer', path: '/', secure: true },
      ]);
      const page = await context.newPage();
      const res = await page.goto(PROJ.manageUrl, { waitUntil: 'networkidle', timeout: 30000 });
      console.log(`page: status=${res?.status()}, url=${page.url()}`);
      await page.screenshot({ path: PROJ.screenshotFile, fullPage: true });
      console.log(`screenshot saved: ${PROJ.screenshotFile}`);
      await browser.close();
    } catch (e) {
      console.log('screenshot failed (non-fatal):', e.message.split('\n')[0]);
      try {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(PROJ.webuiUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.screenshot({ path: PROJ.screenshotFile, fullPage: true });
        console.log(`fallback screenshot saved: ${PROJ.screenshotFile}`);
        await browser.close();
      } catch (e2) { console.log('screenshot failed:', e2.message.split('\n')[0]); }
    }

    console.log('=== done ===');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();

import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import path from 'path';

// Cargar .env de la carpeta raiz
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const ASINS_RAW = process.env.AMAZON_ASINS || 'B0H78BB9TY';
const ASINS = ASINS_RAW.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const CHECK_MINUTES = Math.max(5, parseInt(process.env.CHECK_INTERVAL_MINUTES || '5', 10));
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

console.log(`\n=== PokeTracker ETB Monitor (BROWSER MODE) ===`);
console.log(`ASINs: ${ASINS.join(', ')}`);
console.log(`Intervalo: ${CHECK_MINUTES} min`);
console.log(`Modo: browser (playwright) - antibloqueo Amazon\n`);

async function sendTelegram(msg: string) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' })
    });
  } catch (e) {
    console.log('Error telegram:', e);
  }
}

async function checkOne(asin: string) {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-MX',
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
    }
  });
  const page = await context.newPage();
  try {
    console.log(`\n-> Revisando ${asin}...`);
    await page.goto(`https://www.amazon.com.mx/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000 + Math.random() * 2000); // espera humana

    // Scroll un poco para parecer humano
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1500);

    const data = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const isBlocked = bodyText.includes('Robot') || bodyText.includes('verifica') || document.title.includes('Robot');
      
      // Precio - probar varios selectores
      let priceText = '';
      const selectors = [
        '#corePriceDisplay_desktop_feature_div .a-offscreen',
        '#corePrice_feature_div .a-offscreen',
        '.a-price .a-offscreen',
        '#priceblock_ourprice',
        '#priceblock_dealprice'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.includes('$')) {
          priceText = el.textContent.trim();
          break;
        }
      }
      // fallback regex en html
      if (!priceText) {
        const m = document.documentElement.innerHTML.match(/\$\s*[\d,]+\.?\d*/);
        if (m) priceText = m[0];
      }

      const agotado = bodyText.includes('Temporalmente agotado') || 
                      bodyText.includes('No disponible por el momento') ||
                      bodyText.includes('No disponible');
      
      const disponible = !agotado && !isBlocked && priceText !== '';

      return { priceText, agotado, disponible, isBlocked, title: document.title.substring(0,100) };
    });

    if (data.isBlocked) {
      console.log(`[${new Date().toLocaleTimeString()}] ${asin} | BLOQUEO AMAZON - reintentando en ${CHECK_MINUTES} min | ${data.title}`);
      return;
    }

    const estado = data.agotado ? 'AGOTADO' : (data.disponible ? '¡DISPONIBLE!' : 'NO CLARO');
    console.log(`[${new Date().toLocaleTimeString()}] ${asin} | ${data.priceText || 'Sin precio'} MXN | ${estado} | alerta: no`);

    if (data.disponible && !data.agotado) {
      await sendTelegram(`🚨 *ETB DISPONIBLE* 🚨\nASIN: ${asin}\nPrecio: ${data.priceText}\nLink: https://www.amazon.com.mx/dp/${asin}`);
    }

  } catch (err: any) {
    console.log(`Error revisando ${asin}: ${err.message}`);
  } finally {
    await browser.close();
  }
}

(async () => {
  await sendTelegram(`✅ Monitor iniciado en MODO BROWSER\nProductos: ${ASINS.join(', ')}\nRevisión cada ${CHECK_MINUTES} min`);
  while (true) {
    for (const asin of ASINS) {
      await checkOne(asin);
      // espera 8-12 segundos entre productos para no parecer bot
      const wait = 8000 + Math.random() * 4000;
      console.log(`Esperando ${(wait/1000).toFixed(1)}s antes del siguiente...`);
      await new Promise(r => setTimeout(r, wait));
    }
    console.log(`\nSiguiente revisión: ${new Date(Date.now() + CHECK_MINUTES*60*1000).toLocaleTimeString()} \n`);
    await new Promise(r => setTimeout(r, CHECK_MINUTES * 60 * 1000));
  }
})();

/**
 * Cargobar — Yazdırma Motoru (print-engine.js)
 * ----------------------------------------------
 * Bu modül:
 *   1) "portakal" kütüphanesi ile 100x100mm etiketi doğru yazıcı diline
 *      (varsayılan: TSPL) derler,
 *   2) Derlenen ham komutları yerel Yazdırma Ajanı'na (print-agent) HTTP
 *      ile gönderir.
 *
 * index.html'e şu şekilde eklenir (diğer <script> etiketlerinin YANINA):
 *   <script type="module" src="print-engine.js"></script>
 */

console.log('[PrintEngine] Modül yüklenmeye başladı...');
import { label, tsc } from 'https://esm.sh/portakal';
import { barcodePNG } from 'https://esm.sh/etiket';
console.log('[PrintEngine] esm.sh import\'ları tamamlandı:', { label: typeof label, tsc: typeof tsc, barcodePNG: typeof barcodePNG });

// ─────────────────────────────────────────────────────────
// AYARLAR (localStorage üzerinden kalıcı; Ayarlar ekranından güncellenir)
// ─────────────────────────────────────────────────────────
const LS_KEYS = {
  agentUrl: 'cargobar_agent_url',
  agentToken: 'cargobar_agent_token',
  labelLang: 'cargobar_label_lang' // 'tspl' | 'escpos'
};

function getSetting(key, fallback) {
  return localStorage.getItem(key) || fallback;
}

const Settings = {
  get agentUrl() { return getSetting(LS_KEYS.agentUrl, 'http://localhost:9198'); },
  set agentUrl(v) { localStorage.setItem(LS_KEYS.agentUrl, v); },
  get agentToken() { return getSetting(LS_KEYS.agentToken, ''); },
  set agentToken(v) { localStorage.setItem(LS_KEYS.agentToken, v); },
  get labelLang() { return getSetting(LS_KEYS.labelLang, 'tspl'); },
  set labelLang(v) { localStorage.setItem(LS_KEYS.labelLang, v); }
};

// Millimetreyi Dot cinsine (203 DPI varsayımıyla) çeviren yardımcı fonksiyon
const mm = (v) => Math.round(v * 203 / 25.4);

// ─────────────────────────────────────────────────────────
// GÖRSEL TO MONOCHROME BITMAP DÜNÜŞTÜRÜCÜ
// ─────────────────────────────────────────────────────────
async function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function imageToMonochromeBitmap(imgElement, targetWidth, targetHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(imgElement, 0, 0, targetWidth, targetHeight);
  
  const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imgData.data;
  const bytesPerRow = Math.ceil(targetWidth / 8);
  const buffer = new Uint8Array(bytesPerRow * targetHeight);
  
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const idx = (y * targetWidth + x) * 4;
      const r = data[idx];
      const g = data[idx+1];
      const b = data[idx+2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      
      // Zjiang firmware'i görünüşe göre Mode 0 için standart TSPL (1=Siyah, 0=Beyaz) 
      // mantığını TERS anlıyor (0=Siyah, 1=Beyaz). 
      // Beyaz (arka plan) pikseller için bit=1 gönderiyoruz.
      if (gray >= 128) {
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        buffer[byteIdx] |= (1 << bitIdx);
      }
    }
  }
  const result = {
    data: buffer,
    width: targetWidth,
    height: targetHeight,
    bytesPerRow: bytesPerRow
  };
  return result;
}

// PNG byte dizisini (barcodePNG/qrcodePNG çıktısı) monochrome bitmap'e çevirir.
// rotateDeg: 0 veya 90 — dikey barkod sütunu için 90 kullanılır.
async function pngBytesToMonochromeBitmap(pngBytes, targetWidthDots, targetHeightDots, rotateDeg = 0) {
  const blob = new Blob([pngBytes], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url);
    const canvas = document.createElement('canvas');
    // 90° döndürülecekse tuval boyutlarını yer değiştir
    const cw = rotateDeg === 90 || rotateDeg === 270 ? targetHeightDots : targetWidthDots;
    const ch = rotateDeg === 90 || rotateDeg === 270 ? targetWidthDots : targetHeightDots;
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    if (rotateDeg === 90) {
      ctx.translate(cw, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0, targetWidthDots, targetHeightDots);
    } else {
      ctx.drawImage(img, 0, 0, cw, ch);
    }
    ctx.restore();
    // canvas artık hedef boyutta hazır; mevcut monochrome mantığını burada tekrar kullan
    return imageToMonochromeBitmap(canvas, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─────────────────────────────────────────────────────────
// AJAN İLETİŞİMİ
// ─────────────────────────────────────────────────────────
async function agentFetch(path, options = {}) {
  const url = Settings.agentUrl.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Print-Token': Settings.agentToken,
      ...(options.headers || {})
    }
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'Ajan geçersiz yanıt döndürdü' }));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Ajan hatası (HTTP ${res.status})`);
  }
  return json;
}

async function checkAgentHealth() {
  try {
    const url = Settings.agentUrl.replace(/\/$/, '') + '/health';
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.ok;
  } catch {
    return false;
  }
}

async function listPrinters() {
  const json = await agentFetch('/printers');
  return json.printers || [];
}

async function sendRaw(rawString) {
  return agentFetch('/print', {
    method: 'POST',
    body: JSON.stringify({ data: rawString, encoding: 'utf8' })
  });
}

async function sendTest(lang) {
  return agentFetch(`/test/${lang}`, { method: 'POST', body: '{}' });
}

// Basit satır kaydırma (uzun adresler taşmasın diye)
function wrapText(text, maxChars) {
  if (!text) return '';
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      lines.push(current.trim());
      current = w;
    } else {
      current += ' ' + w;
    }
  }
  if (current) lines.push(current.trim());
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────
// METİN TO MONOCHROME BITMAP DÖNÜŞTÜRÜCÜ
// ─────────────────────────────────────────────────────────
async function renderTextToMonochromeBitmap(text, options = {}) {
  const { 
    fontSize = 20, 
    fontWeight = 'normal', 
    maxWidthDots = 800, 
    reverse = false, 
    rotation = 0,
    align = 'left' 
  } = options;

  const inputLines = (text || '').split('\n');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontWeight} ${fontSize}px sans-serif`;
  
  const lines = [];
  for (const pLine of inputLines) {
    let currentLine = '';
    const words = pLine.split(' ');
    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidthDots && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  
  const lineHeight = Math.round(fontSize * 1.2);
  const totalHeight = Math.max(lineHeight * lines.length, lineHeight);
  
  let actualMaxWidth = 0;
  for (const l of lines) {
    const w = ctx.measureText(l).width;
    if (w > actualMaxWidth) actualMaxWidth = w;
  }
  
  const paddingX = reverse ? 16 : 0;
  const paddingY = reverse ? 8 : 0;
  
  canvas.width = Math.max(8, Math.ceil(actualMaxWidth + paddingX));
  canvas.height = Math.max(8, Math.ceil(totalHeight + paddingY));
  
  ctx.font = `${fontWeight} ${fontSize}px sans-serif`;
  ctx.textBaseline = 'top';
  
  ctx.fillStyle = reverse ? 'black' : 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = reverse ? 'white' : 'black';
  const startX = reverse ? paddingX/2 : 0;
  const startY = reverse ? paddingY/2 : 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let xPos = startX;
    if (align === 'center') {
      const w = ctx.measureText(line).width;
      xPos = (canvas.width - w) / 2;
    }
    ctx.fillText(line, xPos, startY + (i * lineHeight));
  }
  
  let finalCanvas = canvas;
  if (rotation === 90 || rotation === 270) {
    finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvas.height;
    finalCanvas.height = canvas.width;
    const fctx = finalCanvas.getContext('2d');
    fctx.fillStyle = 'white';
    fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    fctx.save();
    if (rotation === 90) {
      fctx.translate(finalCanvas.width, 0);
      fctx.rotate(Math.PI / 2);
    } else {
      fctx.translate(0, finalCanvas.height);
      fctx.rotate(-Math.PI / 2);
    }
    fctx.drawImage(canvas, 0, 0);
    fctx.restore();
  }
  
  return imageToMonochromeBitmap(finalCanvas, finalCanvas.width, finalCanvas.height);
}

// ─────────────────────────────────────────────────────────
// ETİKET TASARIMI (100x100mm)
// ─────────────────────────────────────────────────────────
async function buildLabel(data, customTemplateBase64, copies) {
  const { tkgCode, alici, gonderici, desi } = data;
  let images = [];

  async function addTextBitmap(text, x, y, options, centerPointX = null) {
    if (!text) return;
    const bitmap = await renderTextToMonochromeBitmap(text, options);
    const finalX = centerPointX !== null ? Math.round(centerPointX - bitmap.width / 2) : x;
    images.push({ bitmap, x: finalX, y });
  }

  // 1. ÖZEL ŞABLON AKTİF İSE (Python Absolute Koordinatları)
  if (customTemplateBase64) {
    try {
      const img = await loadImg(customTemplateBase64);
      const bgBitmap = imageToMonochromeBitmap(img, 800, 800);
      images.push({ bitmap: bgBitmap, x: 0, y: 0 });

      const horizontalBarcodeBytes = barcodePNG(tkgCode || '', { type: 'code128', height: 44, barWidth: 2 });
      const horizontalBarcodeBitmap = await pngBytesToMonochromeBitmap(horizontalBarcodeBytes, 320, 80, 0);
      images.push({ bitmap: horizontalBarcodeBitmap, x: mm(30), y: mm(84) });

      const toTrUpper = (str) => (str || '').replace(/i/g, 'İ').toUpperCase();

      const receiverTitle = toTrUpper(alici?.unvan);
      const receiverAddr = toTrUpper(alici?.adres);
      const receiverTel = toTrUpper(alici?.tel);
      const desiStr = `DESİ: ${desi?.desi || '0'} DS.`;

      let lbl = label({ width: 100, height: 100, unit: 'mm', dpi: 203, copies: copies });
      
      await addTextBitmap(receiverTitle, mm(0.22), mm(45.34), { fontSize: 20, fontWeight: 'bold' });
      await addTextBitmap(receiverAddr, mm(0.22), mm(53.00), { fontSize: 20, maxWidthDots: 600 });
      await addTextBitmap(receiverTel, mm(0.22), mm(78.00), { fontSize: 20 });

      await addTextBitmap(`EN : ${desi?.en || '0'}`, mm(51.76), mm(56.59), { fontSize: 20 });
      await addTextBitmap(`BOY : ${desi?.boy || '0'}`, mm(51.76), mm(61.00), { fontSize: 20 });
      await addTextBitmap(`YUKSEKLIK : ${desi?.yukseklik || '0'}`, mm(51.76), mm(65.50), { fontSize: 20 });
      await addTextBitmap(`KILO : ${desi?.kg || '0'}`, mm(51.76), mm(70.00), { fontSize: 20 });
      await addTextBitmap(desiStr, mm(51.76), mm(76.00), { fontSize: 20 });

      await addTextBitmap(tkgCode || '', null, mm(95), { fontSize: 20, align: 'center' }, mm(50));

      return { lbl, images };
    } catch (e) {
      console.error('Özel şablon yüklenirken hata oluştu, varsayılan şablona dönülüyor.', e);
    }
  }

  // 2. VARSAYILAN ŞABLON (ENTERPRISE / MODERN)
  const desiVal = desi?.ucret !== null && desi?.ucret !== undefined ? desi.ucret : '—';
  const kiloVal = desi?.kg ? `${desi.kg} kg` : '—';
  const desiUnit = desi?.kg > 20 && desi?.ucret === desi?.kg ? 'KG' : 'DESİ';
  
  // Barkod: Yatay, alt tarafa ortalanmış (Genişlik: 80mm ~640dot, Yükseklik: 15mm ~120dot)
  const horizontalBarcodeBytes = barcodePNG(tkgCode || '', { type: 'code128', height: 60, barWidth: 3 });
  const horizontalBarcodeBitmap = await pngBytesToMonochromeBitmap(horizontalBarcodeBytes, mm(80), mm(15), 0);
  images.push({ bitmap: horizontalBarcodeBitmap, x: mm(10), y: mm(83) });

  let lbl = label({ width: 100, height: 100, unit: 'mm', dpi: 203, copies: copies })
    // Dış Çerçeve kalın
    .box({ x: mm(0), y: mm(0), width: mm(100), height: mm(100), thickness: mm(1) })
    
    // --- GÖNDERİCİ (0 - 22mm) ---
    .box({ x: mm(0), y: mm(0), width: mm(100), height: mm(22), thickness: mm(0.5) }) // Alt sınır çizgisi
    .line({ x1: mm(0), y1: mm(62), x2: mm(100), y2: mm(62), thickness: mm(0.5) })
    .line({ x1: mm(33), y1: mm(62), x2: mm(33), y2: mm(76), thickness: mm(0.5) })
    .line({ x1: mm(66), y1: mm(62), x2: mm(66), y2: mm(76), thickness: mm(0.5) })
    .line({ x1: mm(0), y1: mm(76), x2: mm(100), y2: mm(76), thickness: mm(0.5) });

  await addTextBitmap(' GÖNDERİCİ / FROM ', mm(2), mm(2), { fontSize: 20, reverse: true });
  await addTextBitmap((gonderici?.unvan || 'ŞİRKET ÜNVANI').substring(0, 45), mm(2), mm(7), { fontSize: 32, fontWeight: 'bold' });
  await addTextBitmap(gonderici?.adres || '', mm(2), mm(13), { fontSize: 22, maxWidthDots: mm(96) });
  
  // --- ALICI (22 - 62mm) ---
  await addTextBitmap(' ALICI / TO ', mm(2), mm(24), { fontSize: 20, reverse: true });
  await addTextBitmap((alici?.unvan || '').substring(0, 32), mm(2), mm(29), { fontSize: 36, fontWeight: 'bold' });
  await addTextBitmap(alici?.adres || '', mm(2), mm(36), { fontSize: 24, maxWidthDots: mm(96) });
  await addTextBitmap(`${alici?.ilce || ''} / ${alici?.il || ''}`.toUpperCase(), mm(2), mm(48), { fontSize: 40, fontWeight: 'bold' });
  await addTextBitmap(`TEL: ${alici?.tel || '—'}`, mm(2), mm(56), { fontSize: 22 });
  
  // --- KARGO BİLGİLERİ (62 - 76mm) ---
  await addTextBitmap('AĞIRLIK', mm(2), mm(64), { fontSize: 20 });
  await addTextBitmap(`${kiloVal}`, mm(2), mm(69), { fontSize: 32, fontWeight: 'bold' });
  
  await addTextBitmap(desiUnit, mm(35), mm(64), { fontSize: 20 });
  await addTextBitmap(`${desiVal}`, mm(35), mm(69), { fontSize: 32, fontWeight: 'bold' });
  
  await addTextBitmap('TARİH', mm(68), mm(64), { fontSize: 20 });
  await addTextBitmap(new Date().toLocaleDateString('tr-TR'), mm(68), mm(69), { fontSize: 32, fontWeight: 'bold' });

  // --- BARKOD BÖLÜMÜ (76 - 100mm) ---
  await addTextBitmap(tkgCode || '', null, mm(78), { fontSize: 26, align: 'center' }, mm(50));

  return { lbl, images };
}

// Resimleri TSPL'e binary olarak yerleştirmek için özel derleyici
function compileToTSPLBase64(lbl, images, copies) {
  const tsplStr = tsc.compile(lbl);
  const lines = tsplStr.split(/\r?\n/);
  
  let printCmd = `PRINT ${copies},1\r\n`;
  let printIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('PRINT ')) {
      printCmd = lines[i] + '\r\n';
      printIndex = i;
      break;
    }
  }
  
  let beforePrint = tsplStr;
  if (printIndex !== -1) {
    beforePrint = lines.slice(0, printIndex).join('\r\n') + '\r\n';
  }
  
  // Artık metinleri TSPL text komutuyla DEĞİL, resim olarak bastığımız için
  // özel codepage (1254) ya da özel encoder'a gerek kalmadı. Standart UTF-8 kullanabiliriz.
  const enc = new TextEncoder();
  const buffers = [enc.encode(beforePrint)];
  
  for (const img of images) {
    const header = `BITMAP ${img.x},${img.y},${img.bitmap.bytesPerRow},${img.bitmap.height},0,`;
    buffers.push(enc.encode(header));
    buffers.push(img.bitmap.data); // HAM BINARY DATA
    buffers.push(enc.encode('\r\n'));
  }
  
  if (printIndex !== -1) {
    buffers.push(enc.encode(printCmd));
  }
  
  const totalLen = buffers.reduce((s, b) => s + b.length, 0);
  const finalBuf = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of buffers) {
    finalBuf.set(b, offset);
    offset += b.length;
  }
  
  let binary = '';
  for (let i = 0; i < finalBuf.length; i++) {
    binary += String.fromCharCode(finalBuf[i]);
  }
  return window.btoa(binary);
}

// ─────────────────────────────────────────────────────────
// DIŞA AÇILAN ANA FONKSİYON
// ─────────────────────────────────────────────────────────
async function printShippingLabel(data, copies = 1) {
  console.log('YAZDIRILAN VERİ:', JSON.stringify(data, null, 2));

  const healthy = await checkAgentHealth();
  if (!healthy) {
    throw new Error(
      'Yazdırma Ajanı bulunamadı. Yazıcının bağlı olduğu bilgisayarda ' +
      'print-agent servisinin çalıştığından emin olun (bkz. README).'
    );
  }

  const rawPrefs = localStorage.getItem('cb_prefs');
  let customTemplate = null;
  if (rawPrefs) {
    try { customTemplate = JSON.parse(rawPrefs).customTemplate || null; } catch {}
  }
  
  const { lbl, images } = await buildLabel(data, customTemplate, copies);
  const base64Data = compileToTSPLBase64(lbl, images, copies);

  // Ajanın /print endpoint'ine base64 olarak gönder
  await agentFetch('/print', {
    method: 'POST',
    body: JSON.stringify({ data: base64Data, encoding: 'base64' })
  });
  return true;
}

// ─────────────────────────────────────────────────────────
// ÖNİZLEME (yazıcıya gitmez, sadece SVG üretir — agent gerekmez)
// ─────────────────────────────────────────────────────────
async function previewShippingLabel(data, copies = 1) {
  const rawPrefs = localStorage.getItem('cb_prefs');
  let customTemplate = null;
  if (rawPrefs) {
    try { customTemplate = JSON.parse(rawPrefs).customTemplate || null; } catch {}
  }
  
  const { lbl, images } = await buildLabel(data, customTemplate, copies);
  
  // Önizleme (SVG) için resimleri Label nesnesine tekrar ekle
  for (const img of images) {
    lbl.image(img.bitmap, { x: img.x, y: img.y, width: img.bitmap.width, height: img.bitmap.height });
  }
  
  const code = tsc.compile(lbl);
  const svg = tsc.preview(lbl);
  const validation = tsc.validate(code);
  return { svg, code, validation };
}

// ─────────────────────────────────────────────────────────
window.PrintEngine = {
  Settings,
  checkAgentHealth,
  listPrinters,
  sendTest,
  printShippingLabel,
  previewShippingLabel
};
console.log('[PrintEngine] window.PrintEngine başarıyla set edildi ✓');

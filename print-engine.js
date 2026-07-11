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
// GÖRSEL TO MONOCHROME BITMAP DÖNÜŞTÜRÜCÜ
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
      if (gray < 128) {
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
  console.log('[DEBUG] imageToMonochromeBitmap çıktısı:', {
    'data.length': result.data.length,
    'data constructor': result.data.constructor.name,
    width: result.width,
    height: result.height,
    bytesPerRow: result.bytesPerRow,
    'beklenen data.length': result.bytesPerRow * result.height,
    'eşleşiyor mu': result.data.length === result.bytesPerRow * result.height
  });
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
// ETİKET TASARIMI (100x100mm)
// ─────────────────────────────────────────────────────────
async function buildLabel(data, customTemplateBase64, copies) {
  const { tkgCode, alici, gonderici, desi } = data;
  let images = [];

  // 1. ÖZEL ŞABLON AKTİF İSE (Python Absolute Koordinatları)
  if (customTemplateBase64) {
    try {
      const img = await loadImg(customTemplateBase64);
      // 100x100mm etiket için 203 DPI = 800x800 dot çözünürlük
      const bgBitmap = imageToMonochromeBitmap(img, 800, 800);
      images.push({ bitmap: bgBitmap, x: 0, y: 0 });

      const horizontalBarcodeBytes = barcodePNG(tkgCode || '', { type: 'code128', height: 44, barWidth: 2 });
      const horizontalBarcodeBitmap = await pngBytesToMonochromeBitmap(horizontalBarcodeBytes, 320, 80, 0);
      images.push({ bitmap: horizontalBarcodeBitmap, x: mm(30), y: mm(84) });

      // Türkçe i/İ düzeltmeli Büyük Harf
      const toTrUpper = (str) => (str || '').replace(/i/g, 'İ').toUpperCase();

      const receiverTitle = toTrUpper(alici?.unvan);
      const receiverAddr = toTrUpper(alici?.adres);
      const receiverTel = toTrUpper(alici?.tel);
      const desiStr = `DESİ: ${desi?.desi || '0'} DS.`;

      let lbl = label({ width: 100, height: 100, unit: 'mm', dpi: 203, copies: copies })
        // Alıcı Bilgileri
        .text(receiverTitle, { x: mm(0.22), y: mm(45.34), font: '1', size: 1 })
        .text(receiverAddr, { x: mm(0.22), y: mm(53.00), font: '1', size: 1 })
        .text(receiverTel, { x: mm(0.22), y: mm(78.00), font: '1', size: 1 })

        // Desi Bilgileri
        .text(`EN : ${desi?.en || '0'}`, { x: mm(51.76), y: mm(56.59), font: '1', size: 1 })
        .text(`BOY : ${desi?.boy || '0'}`, { x: mm(51.76), y: mm(61.00), font: '1', size: 1 })
        .text(`YUKSEKLIK : ${desi?.yukseklik || '0'}`, { x: mm(51.76), y: mm(65.50), font: '1', size: 1 })
        .text(`KILO : ${desi?.kg || '0'}`, { x: mm(51.76), y: mm(70.00), font: '1', size: 1 })
        .text(desiStr, { x: mm(51.76), y: mm(76.00), font: '1', size: 1 })

        // Barkod (Metin kısmı)
        .text(tkgCode || '', { x: mm(50), y: mm(95), font: '1', size: 1, align: 'center' });

      return { lbl, images };
    } catch (e) {
      console.error('Özel şablon yüklenirken hata oluştu, varsayılan şablona dönülüyor.', e);
    }
  }

  // 2. VARSAYILAN ŞABLON (KLASİK ENTRİO KARGO)
  const desiVal = desi?.ucret !== null && desi?.ucret !== undefined ? desi.ucret : '—';
  const kiloVal = desi?.kg ? `${desi.kg} kg` : '—';
  const desiUnit = desi?.kg > 20 && desi?.ucret === desi?.kg ? 'KG' : 'DESİ';
  
  const verticalBarcodeBytes = barcodePNG(tkgCode || '', { type: 'code128' });
  const verticalBarcodeBitmap = await pngBytesToMonochromeBitmap(verticalBarcodeBytes, 320, 80, 90);
  images.push({ bitmap: verticalBarcodeBitmap, x: mm(87), y: mm(20) });

  let lbl = label({ width: 100, height: 100, unit: 'mm', dpi: 203, copies: copies })
    // Dış Çerçeve
    .box({ x: 0, y: 0, width: 800, height: 800, thickness: 4 })
    
    // Header Bölümü
    .text(gonderici?.unvan || 'ŞİRKET ÜNVANI', { x: mm(5), y: mm(4), size: 2 })
    .text(gonderici?.slogan || '', { x: mm(5), y: mm(10), size: 1 })
    .line({ x1: mm(0), y1: mm(16), x2: mm(100), y2: mm(16), thickness: 2 })

    // Orta Panel Bölücü Çizgi (Dikey)
    .line({ x1: mm(85), y1: mm(16), x2: mm(85), y2: mm(78), thickness: 2 })

    // GÖNDERİCİ
    .text('GÖNDERİCİ', { x: mm(4), y: mm(18), size: 1, reverse: true })
    .text(gonderici?.unvan || '', { x: mm(4), y: mm(22), size: 1 })
    .text(wrapText(gonderici?.adres || '', 36), { x: mm(4), y: mm(26), size: 1 })
    
    .line({ x1: mm(0), y1: mm(45), x2: mm(85), y2: mm(45), thickness: 2 })

    // ALICI
    .text('ALICI', { x: mm(4), y: mm(47), size: 1, reverse: true })
    .text(alici?.unvan || '', { x: mm(4), y: mm(51), size: 1 })
    .text(wrapText(alici?.adres || '', 36), { x: mm(4), y: mm(55), size: 1 })
    .text(`${alici?.ilce || ''} / ${alici?.il || ''}`, { x: mm(4), y: mm(68), size: 1 })

    // Dikey Barkod Bölümü Metni
    .text(tkgCode || '', { x: mm(97), y: mm(45), size: 1, rotation: 90 })

    .line({ x1: mm(0), y1: mm(78), x2: mm(100), y2: mm(78), thickness: 2 })

    // Kargo Desi/Kilo Tablosu
    .text(`${desiVal} ${desiUnit}`, { x: mm(5), y: mm(81), size: 2 })
    .text(`${kiloVal} AGIRLIK`, { x: mm(35), y: mm(81), size: 2 });

  return { lbl, images };
}

// TSPL metinlerini UTF-8 yerine Windows-1254 (Türkçe) byte dizisine çeviren fonksiyon.
// Zjiang gibi yazıcılar UTF-8'i doğrudan desteklemeyebilir, bu nedenle CP1254 zorunludur.
function encodeCP1254(str) {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    switch(code) {
      case 0x011E: buf[i] = 208; break; // Ğ
      case 0x011F: buf[i] = 240; break; // ğ
      case 0x0130: buf[i] = 221; break; // İ
      case 0x0131: buf[i] = 253; break; // ı
      case 0x015E: buf[i] = 222; break; // Ş
      case 0x015F: buf[i] = 254; break; // ş
      case 0x00C7: buf[i] = 199; break; // Ç
      case 0x00E7: buf[i] = 231; break; // ç
      case 0x00D6: buf[i] = 214; break; // Ö
      case 0x00F6: buf[i] = 246; break; // ö
      case 0x00DC: buf[i] = 220; break; // Ü
      case 0x00FC: buf[i] = 252; break; // ü
      default:
        // Eğer karakter ISO-8859-9 (Latin-5) aralığındaysa olduğu gibi bırak (ASCII vs.)
        // Bilinmeyen karakterse '?' (63) bas.
        buf[i] = code < 256 ? code : 63; 
    }
  }
  return buf;
}

// Resimleri TSPL'e binary olarak yerleştirmek için özel derleyici
function compileToTSPLBase64(lbl, images, copies) {
  const tsplStr = tsc.compile(lbl);
  const lines = tsplStr.split(/\r?\n/);
  
  // PRINT komutunu bul ve ayır (resimleri PRINT'ten hemen önce ekleyeceğiz)
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
  
  // En başa CODEPAGE 1254 komutunu ekliyoruz
  beforePrint = "CODEPAGE 1254\r\n" + beforePrint;
  
  // Artık TextEncoder (UTF-8) YERİNE encodeCP1254 kullanıyoruz.
  const buffers = [encodeCP1254(beforePrint)];
  
  for (const img of images) {
    // BITMAP x, y, width_bytes, height, mode
    const header = `BITMAP ${img.x},${img.y},${img.bitmap.bytesPerRow},${img.bitmap.height},0,`;
    buffers.push(encodeCP1254(header));
    buffers.push(img.bitmap.data); // HAM BINARY DATA
    buffers.push(encodeCP1254('\r\n'));
  }
  
  if (printIndex !== -1) {
    buffers.push(encodeCP1254(printCmd));
  }
  
  const totalLen = buffers.reduce((s, b) => s + b.length, 0);
  const finalBuf = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of buffers) {
    finalBuf.set(b, offset);
    offset += b.length;
  }
  
  // Uint8Array'i Base64'e dönüştür
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

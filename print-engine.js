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

import { label } from 'https://esm.sh/portakal/core';
import { tsc } from 'https://esm.sh/portakal/lang/tsc';
import { escpos } from 'https://esm.sh/portakal/lang/escpos';
import { barcodePNG, qrcodePNG } from 'https://esm.sh/etiket/png';

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
  return {
    data: buffer,
    width: targetWidth,
    height: targetHeight,
    bytesPerRow: bytesPerRow
  };
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
  return agentFetch('/print', {\n    method: 'POST',\n    body: JSON.stringify({ data: rawString, encoding: 'utf8' })\n  });
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
async function buildLabel(data, customTemplateBase64) {
  const { tkgCode, alici, gonderici, desi } = data;

  // Barkodu render et (etiket kütüphanesi monochrome bitmap döner)
  const barcode = barcodePNG(tkgCode || '', { type: 'code128', height: 44, barWidth: 2 });

  // 1. ÖZEL ŞABLON AKTİF İSE (Python Absolute Koordinatları)
  if (customTemplateBase64) {
    try {
      const img = await loadImg(customTemplateBase64);
      // 100x100mm etiket için 203 DPI = 800x800 dot çözünürlük
      const bgBitmap = imageToMonochromeBitmap(img, 800, 800);

      // Türkçe i/İ düzeltmeli Büyük Harf
      const toTrUpper = (str) => (str || '').replace(/i/g, 'İ').toUpperCase();

      const receiverTitle = toTrUpper(alici?.unvan);
      const receiverAddr = toTrUpper(alici?.adres);
      const receiverTel = toTrUpper(alici?.tel);
      const desiStr = `DESİ: ${desi?.desi || '0'} DS.`;

      let lbl = label({ width: 100, height: 100, unit: 'mm', dpi: 203 })
        .image(bgBitmap, { x: 0, y: 0, width: 800, height: 800 })
        
        // Alıcı Bilgileri (Python koordinatları: x=0.22mm, y=45.34mm, genislik=37.32mm)
        // portakal.text text-wrapping desteği için maxWidth parametresi dot cinsinden alır
        .text(receiverTitle, { x: 0.22, y: 45.34, font: '1', size: 1 })
        .text(receiverAddr, { x: 0.22, y: 53.00, font: '1', size: 1 })
        .text(receiverTel, { x: 0.22, y: 78.00, font: '1', size: 1 })

        // Desi Bilgileri (Python koordinatları: x=51.76mm, y=56.59mm, genislik=37.32mm)
        .text(`EN : ${desi?.en || '0'}`, { x: 51.76, y: 56.59, font: '1', size: 1 })
        .text(`BOY : ${desi?.boy || '0'}`, { x: 51.76, y: 61.00, font: '1', size: 1 })
        .text(`YUKSEKLIK : ${desi?.yukseklik || '0'}`, { x: 51.76, y: 65.50, font: '1', size: 1 })
        .text(`KILO : ${desi?.kg || '0'}`, { x: 51.76, y: 70.00, font: '1', size: 1 })
        .text(desiStr, { x: 51.76, y: 76.00, font: '1', size: 1 })

        // Barkod (Python koordinatları: x=30mm, y=86mm)
        .image(barcode, { x: 30, y: 84, width: 320, height: 80 })
        .text(tkgCode || '', { x: 50, y: 95, font: '1', size: 1, align: 'center' });

      return lbl;
    } catch (e) {
      console.error('Özel şablon yüklenirken hata oluştu, varsayılan şablona dönülüyor.', e);
    }
  }

  // 2. VARSAYILAN ŞABLON (KLASİK ENTRİO KARGO)
  const desiVal = desi?.ucret !== null && desi?.ucret !== undefined ? desi.ucret : '—';
  const kiloVal = desi?.kg ? `${desi.kg} kg` : '—';
  const desiUnit = desi?.kg > 20 && desi?.ucret === desi?.kg ? 'KG' : 'DESİ';
  
  let lbl = label({ width: 100, height: 100, unit: 'mm', dpi: 203 })
    // Dış Çerçeve
    .box({ x: 0, y: 0, width: 800, height: 800, thickness: 4 })
    
    // Header Bölümü
    .text(gonderici?.unvan || 'ŞİRKET ÜNVANI', { x: 5, y: 4, size: 2 })
    .text(gonderici?.slogan || '', { x: 5, y: 10, size: 1 })
    .line({ x1: 0, y1: 16, x2: 100, y2: 16, thickness: 1 })

    // Orta Panel Bölücü Çizgi (Dikey)
    .line({ x1: 85, y1: 16, x2: 85, y2: 78, thickness: 1 })

    // GÖNDERİCİ
    .text('GÖNDERİCİ', { x: 4, y: 18, size: 1, reverse: true })
    .text(gonderici?.unvan || '', { x: 4, y: 22, size: 1 })
    .text(wrapText(gonderici?.adres || '', 36), { x: 4, y: 26, size: 1 })
    
    .line({ x1: 0, y1: 45, x2: 85, y2: 45, thickness: 1 })

    // ALICI
    .text('ALICI', { x: 4, y: 47, size: 1, reverse: true })
    .text(alici?.unvan || '', { x: 4, y: 51, size: 1 })
    .text(wrapText(alici?.adres || '', 36), { x: 4, y: 55, size: 1 })
    .text(`${alici?.ilce || ''} / ${alici?.il || ''}`, { x: 4, y: 68, size: 1 })

    // Dikey Barkod Bölümü (Sağ Sütun)
    // portakal Z veya T dillerinde görsel döndürme desteği sunar. 90 derece dikey barkod ekliyoruz.
    .image(barcode, { x: 87, y: 20, width: 80, height: 320, rotation: 90 })
    .text(tkgCode || '', { x: 97, y: 45, size: 1, rotation: 90 })

    .line({ x1: 0, y1: 78, x2: 100, y2: 78, thickness: 1 })

    // Kargo Desi/Kilo Tablosu
    .text(`${desiVal} ${desiUnit}`, { x: 5, y: 81, size: 2 })
    .text(`${kiloVal} AGIRLIK`, { x: 35, y: 81, size: 2 });

    // QR Code
    try {
      const qr = qrcodePNG('https://www.tantex.com.tr', { size: 120 });
      lbl = lbl.image(qr, { x: 72, y: 80, width: 120, height: 120 });
    } catch(e) {
      console.error('QR code generation failed:', e);
    }

  return lbl;
}

function compile(lbl) {
  return Settings.labelLang === 'escpos' ? escpos.compile(lbl) : tsc.compile(lbl);
}

// ─────────────────────────────────────────────────────────
// DIŞA AÇILAN ANA FONKSİYON
// ─────────────────────────────────────────────────────────
async function printShippingLabel(data, copies = 1) {
  const healthy = await checkAgentHealth();
  if (!healthy) {
    throw new Error(
      'Yazdırma Ajanı bulunamadı. Yazıcının bağlı olduğu bilgisayarda ' +
      'print-agent servisinin çalıştığından emin olun (bkz. README).'
    );
  }

  // Local storage'dan custom şablonu çek
  const rawPrefs = localStorage.getItem('cb_prefs');
  let customTemplate = null;
  if (rawPrefs) {
    try {
      const prefs = JSON.parse(rawPrefs);
      customTemplate = prefs.customTemplate || null;
    } catch (e) {
      console.error('Could not parse prefs for custom template:', e);
    }
  }

  const lbl = await buildLabel(data, customTemplate);
  let raw = compile(lbl);

  // Kopya sayısını ayarlıyoruz
  if (Settings.labelLang === 'tspl' && copies > 1) {
    raw = raw.replace(/PRINT\s+1\s*,\s*1/i, `PRINT 1,${copies}`);
  }

  await sendRaw(raw);
  return true;
}

// ─────────────────────────────────────────────────────────
window.PrintEngine = {\n  Settings,\n  checkAgentHealth,\n  listPrinters,\n  sendTest,\n  printShippingLabel\n};

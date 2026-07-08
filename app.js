// ═══════════════════════════════════════════════
//  Cargobar v2 — Main Application
// ═══════════════════════════════════════════════

/* ────────────────────────────────────────
   SUPABASE CLIENT
──────────────────────────────────────── */
const supabaseUrl = 'https://wtpijizimadhxcwidrqo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0cGlqaXppbWFkaHhjd2lkcnFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1Mjk0MTQsImV4cCI6MjA5OTEwNTQxNH0.SyYjzqdmwyhdGKcaB5KTo_xAjbsrpPeKBXZ5WeKcCGc';
let _db = null;
try {
  _db = window.supabase.createClient(supabaseUrl, supabaseKey);
} catch(e) {
  console.error('Supabase SDK yüklenemedi, localStorage modunda çalışılıyor.', e);
}

/* ────────────────────────────────────────
   STATE
──────────────────────────────────────── */
const State = {
  session: null,
  customers: [],
  tkg_counter: 1,
  print_count: 0,
  isPrinting: false,  // Guard flag to prevent router re-render during window.print()

  // Company profile
  company: {
    unvan: '',
    slogan: '',
    telefon: '',
    adres: '',
    il: '',
    ilce: '',
    logo: '',   // base64 data URL
  },

  // Slip form state
  mode: 'new',             // 'new' | 'saved'
  selectedCustomer: null,  // saved customer object or null
  pendingPrintData: null,  // data waiting after save-prompt
};

/* ────────────────────────────────────────
   STORAGE HELPERS
──────────────────────────────────────── */
const Store = {
  async load() {
    // Local counters
    State.tkg_counter = parseInt(localStorage.getItem('cb_tkg_counter') || '1', 10);
    State.print_count = parseInt(localStorage.getItem('cb_print_count') || '0', 10);

    if (!_db) {
      // Fallback to localStorage
      const raw = localStorage.getItem('cb_customers');
      State.customers = raw ? JSON.parse(raw) : [...window.MOCK_CUSTOMERS];
      const rawCompany = localStorage.getItem('cb_company');
      if (rawCompany) State.company = { ...State.company, ...JSON.parse(rawCompany) };
      return;
    }

    // Fetch from Supabase
    try {
      const { data: custData, error: custErr } = await _db.from('customers').select('*').order('created_at', { ascending: false });
      if (!custErr && custData) {
        State.customers = custData;
      } else {
        State.customers = [...window.MOCK_CUSTOMERS];
      }

      const { data: compData, error: compErr } = await _db.from('company').select('*').eq('id', 1).single();
      if (!compErr && compData) {
        State.company = { ...State.company, ...compData };
      }
    } catch (err) {
      console.error("Supabase load error:", err);
      const raw = localStorage.getItem('cb_customers');
      State.customers = raw ? JSON.parse(raw) : [...window.MOCK_CUSTOMERS];
    }
  },
  
  async saveCustomer(customer) {
    if (!_db) {
      // Fallback
      const idx = State.customers.findIndex(c => c.id === customer.id);
      if (idx === -1) State.customers.push(customer);
      else State.customers[idx] = customer;
      localStorage.setItem('cb_customers', JSON.stringify(State.customers));
      return;
    }
    const { error } = await _db.from('customers').upsert(customer);
    if (error) console.error("Error saving customer:", error);
  },

  async deleteCustomer(id) {
    if (!_db) {
      State.customers = State.customers.filter(c => c.id !== id);
      localStorage.setItem('cb_customers', JSON.stringify(State.customers));
      return;
    }
    const { error } = await _db.from('customers').delete().eq('id', id);
    if (error) console.error("Error deleting customer:", error);
  },

  saveTKG() {
    localStorage.setItem('cb_tkg_counter', String(State.tkg_counter));
  },
  savePrintCount() {
    localStorage.setItem('cb_print_count', String(State.print_count));
  },
  
  async saveCompany() {
    if (!_db) {
      localStorage.setItem('cb_company', JSON.stringify(State.company));
      return;
    }
    const { error } = await _db.from('company').upsert({ id: 1, ...State.company });
    if (error) console.error("Error saving company:", error);
  },
};

/* ────────────────────────────────────────
   TKG CODE GENERATOR
──────────────────────────────────────── */
const TKG = {
  current() {
    return 'TKG-' + String(State.tkg_counter).padStart(6, '0');
  },
  next() {
    State.tkg_counter++;
    Store.saveTKG();
    return this.current();
  },
  setInputValue() {
    const el = document.getElementById('tkg-input');
    if (el) el.value = this.current();
  },
};

/* ────────────────────────────────────────
   ROUTING
──────────────────────────────────────── */
const Router = {
  init() {
    // Guard: set isPrinting BEFORE the print dialog opens (beforeprint) and clear it AFTER (afterprint).
    // window.print() returns synchronously in Chrome, but hashchange can fire async after the
    // dialog closes. Using beforeprint/afterprint events gives us the correct async window.
    window.addEventListener('beforeprint', () => { State.isPrinting = true; });
    window.addEventListener('afterprint',  () => {
      // Keep the guard up for 300ms after dialog closes to catch any trailing hashchange
      setTimeout(() => { State.isPrinting = false; }, 300);
    });

    window.addEventListener('hashchange', () => {
      if (State.isPrinting) return;
      this.route();
    });
    this.route();
  },
  route() {
    const hash = window.location.hash || '#/slip';
    const views = { '#/slip': 'view-slip', '#/customers': 'view-customers', '#/company': 'view-company' };
    const menus = { '#/slip': 'menu-slip', '#/customers': 'menu-customers', '#/company': 'menu-company' };

    document.querySelectorAll('.view-pane').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));

    const viewKey = Object.keys(views).find(k => hash.startsWith(k)) || '#/slip';
    document.getElementById(views[viewKey])?.classList.add('active');
    document.getElementById(menus[viewKey])?.classList.add('active');

    if (viewKey === '#/customers') App.renderCustomersTable();
    if (viewKey === '#/company') App.renderCompanyForm();
    // Sync dock active indicator
    if (window.Dock) Dock.updateActive();
  },
};

/* ────────────────────────────────────────
   SLIP — Kargo Fişi Logic
──────────────────────────────────────── */
const Slip = {
  setMode(mode) {
    State.mode = mode;
    State.selectedCustomer = null;

    const newCard   = document.getElementById('mode-new-card');
    const savedCard = document.getElementById('mode-saved-card');
    const savedArea = document.getElementById('saved-customer-select-area');
    const badge     = document.getElementById('selected-customer-badge');
    const pickerBtn = document.getElementById('open-customer-picker-btn');

    newCard.classList.toggle('selected', mode === 'new');
    savedCard.classList.toggle('selected', mode === 'saved');
    savedArea.style.display = mode === 'saved' ? 'block' : 'none';

    // Critical fix: always reset picker/badge visibility on any mode switch
    if (pickerBtn) pickerBtn.style.display = 'flex';
    if (badge)     badge.style.display     = 'none';

    Slip.clearForm();
    TKG.setInputValue();
    this.syncSummary();
  },

  clearForm() {
    ['f-unvan','f-ad','f-tel','f-adres','f-ilce','f-il'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  },

  fillFromCustomer(cust) {
    document.getElementById('f-unvan').value = cust.unvan || '';
    document.getElementById('f-ad').value    = cust.ad    || '';
    document.getElementById('f-tel').value   = cust.telefon || '';
    document.getElementById('f-adres').value = cust.adres || '';
    
    const ilSelect = document.getElementById('f-il');
    ilSelect.value = cust.il || '';
    App.handleCityChange('f-il', 'f-ilce');
    
    document.getElementById('f-ilce').value  = cust.ilce  || '';
    this.syncSummary();
  },

  clearSelectedCustomer() {
    State.selectedCustomer = null;
    document.getElementById('selected-customer-badge').style.display = 'none';
    document.getElementById('open-customer-picker-btn').style.display = 'flex';
    Slip.clearForm();
    TKG.setInputValue();
    this.syncSummary();
  },

  calcDesi() {
    const en  = parseFloat(document.getElementById('d-en').value) || 0;
    const boy = parseFloat(document.getElementById('d-boy').value) || 0;
    const yuk = parseFloat(document.getElementById('d-yukseklik').value) || 0;
    const kg  = parseFloat(document.getElementById('d-kilo').value) || 0;

    const resHacimsel = document.getElementById('res-hacimsel');
    const resKilo     = document.getElementById('res-kilo');
    const resUcret    = document.getElementById('res-ucret');
    const resultCard  = document.getElementById('desi-result-card');

    if (!en || !boy || !yuk) {
      resHacimsel.textContent = '—';
      resKilo.textContent     = kg ? `${kg} kg` : '—';
      resUcret.textContent    = '—';
      resultCard.classList.remove('dhl-active');
      this.syncSummary();
      return;
    }

    // Formül: En × Boy × Yükseklik / 3000
    const hacimselDesi = (en * boy * yuk) / 3000;
    const roundedHacimsel = Math.round(hacimselDesi * 10) / 10;

    // DHL kuralı: ağırlık > 20kg ise ücretlendirme = max(hacimsel, kg)
    let ucretDesi = roundedHacimsel;
    let dhlActive = false;
    if (kg > 20) {
      ucretDesi = Math.max(roundedHacimsel, kg);
      dhlActive = true;
    }

    resHacimsel.textContent = roundedHacimsel + ' desi';
    resKilo.textContent     = kg ? `${kg} kg` : '—';
    resUcret.textContent    = ucretDesi + (kg > 20 && ucretDesi === kg ? ' kg' : ' desi');
    resUcret.style.color    = dhlActive ? 'var(--amber)' : 'var(--accent-light)';

    resultCard.classList.toggle('dhl-active', dhlActive);

    this.syncSummary();
  },

  getDesiData() {
    const en  = parseFloat(document.getElementById('d-en').value) || 0;
    const boy = parseFloat(document.getElementById('d-boy').value) || 0;
    const yuk = parseFloat(document.getElementById('d-yukseklik').value) || 0;
    const kg  = parseFloat(document.getElementById('d-kilo').value) || 0;
    const hacimsel = en && boy && yuk ? Math.round((en * boy * yuk) / 3000 * 10) / 10 : null;
    let ucret = hacimsel;
    if (kg > 20 && hacimsel !== null) ucret = Math.max(hacimsel, kg);
    return { en, boy, yuk, kg, hacimsel, ucret };
  },

  adjustCopies(delta) {
    const inp = document.getElementById('copy-count');
    let val = parseInt(inp.value, 10) || 1;
    val = Math.max(1, Math.min(100, val + delta));
    inp.value = val;
    this.syncSummary();
  },

  regenerateTKG() {
    TKG.next();
    TKG.setInputValue();
    this.syncSummary();
  },

  syncSummary() {
    const unvan = document.getElementById('f-unvan')?.value?.trim();
    const il    = document.getElementById('f-il')?.value?.trim();
    const ilce  = document.getElementById('f-ilce')?.value?.trim();
    const copies = parseInt(document.getElementById('copy-count')?.value, 10) || 1;
    const tkg   = document.getElementById('tkg-input')?.value?.trim();
    const desi  = this.getDesiData();

    let html = '';
    if (unvan) html += `<strong>${unvan}</strong><br>`;
    if (ilce && il) html += `${ilce} / ${il}<br>`;
    if (desi.ucret !== null) {
      html += `Desi: <strong>${desi.ucret}</strong>`;
      if (desi.kg) html += ` | Ağırlık: <strong>${desi.kg} kg</strong>`;
      html += '<br>';
    }
    if (tkg) html += `Kargo Kodu: <strong class="font-mono">${tkg}</strong><br>`;
    html += `Etiket Adeti: <strong>${copies} kopya</strong>`;

    const box = document.getElementById('print-summary');
    if (box) box.innerHTML = html || '<span style="color:var(--text-muted);">Form dolduruldukça özet burada görünür.</span>';
  },

  getFormData() {
    return {
      unvan:  document.getElementById('f-unvan')?.value?.trim()  || '',
      ad:     document.getElementById('f-ad')?.value?.trim()     || '',
      telefon:document.getElementById('f-tel')?.value?.trim()    || '',
      adres:  document.getElementById('f-adres')?.value?.trim()  || '',
      ilce:   document.getElementById('f-ilce')?.value?.trim()   || '',
      il:     document.getElementById('f-il')?.value?.trim()     || '',
    };
  },

  validateForm() {
    const d = this.getFormData();
    const missing = [];
    if (!d.unvan)   missing.push('Firma Ünvanı');
    // Yetkili adı opsiyonel — zorunlu değil
    if (!d.telefon) missing.push('Telefon');
    if (!d.adres)   missing.push('Adres');
    if (!d.ilce)    missing.push('İlçe');
    if (!d.il)      missing.push('İl');
    return missing;
  },

  handlePrint() {
    const missing = this.validateForm();
    if (missing.length > 0) {
      App.showAlert('Eksik Alanlar', `Lütfen şu zorunlu alanları doldurunuz:<br><br><b style="color:var(--amber);">• ${missing.join('<br>• ')}</b>`);
      return;
    }

    const formData = this.getFormData();
    const desiData = this.getDesiData();
    const copies   = Math.max(1, parseInt(document.getElementById('copy-count').value, 10) || 1);
    const tkg      = document.getElementById('tkg-input').value.trim() || TKG.current();

    const printData = { formData, desiData, copies, tkg };

    // New customer → ask to save
    if (State.mode === 'new') {
      State.pendingPrintData = printData;
      document.getElementById('save-prompt-name').textContent = formData.unvan;
      App.openModal('modal-save-prompt');
    } else {
      // Saved customer → print directly
      Slip.executePrint(printData);
    }
  },

  executePrint(data) {
    const { formData, desiData, copies, tkg } = data;

    // Build print area with N label pages
    const area = document.getElementById('print-area');
    area.innerHTML = '';

    for (let i = 0; i < copies; i++) {
      area.appendChild(LabelBuilder.buildLabel(formData, desiData, tkg));
    }

    // Render barcodes in print area
    area.querySelectorAll('.barcode-svg').forEach(svg => {
      try {
        JsBarcode(svg, svg.dataset.value, {
          format: 'CODE128',
          width: 1.2,
          height: 44,
          displayValue: false,
          margin: 0,
          background: 'transparent',
          lineColor: '#000',
        });
      } catch(e) { /* silent */ }
    });

    // Render QR codes
    area.querySelectorAll('.qrcode-div').forEach(div => {
      try {
        new QRCode(div, {
          text: div.dataset.value,
          width: 48,
          height: 48,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.L
        });
      } catch(e) { /* silent */ }
    });

    // Increment print count
    State.print_count += copies;
    Store.savePrintCount();

    // To completely eliminate the visual flicker (where the UI disappears because of @media print),
    // we use a hidden iframe to execute the print dialog. This isolates the print layout from the main screen.
    setTimeout(() => {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <link rel="stylesheet" href="index.css">
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&display=swap" rel="stylesheet">
          <style>
            @page { size: 100mm 100mm; margin: 0; }
            body { margin: 0; padding: 0; background: #fff; }
          </style>
        </head>
        <body>
          <div id="print-area" style="display: block !important; position: static !important; width: 100%;">
            ${area.innerHTML}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 50);
            };
          </script>
        </body>
        </html>
      `);
      doc.close();

      // Cleanup iframe after a generous delay so it doesn't interrupt the print dialog
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 10000);
      
    }, 50);

    // After printing: ONLY advance TKG if we used the current one
    if (tkg === TKG.current()) {
      TKG.next();
    }
    // Note: We DO NOT call TKG.setInputValue() here, so the input remains the same!
    Slip.syncSummary();
  },
};

/* ────────────────────────────────────────
   LABEL BUILDER — generates the 100x100mm HTML
──────────────────────────────────────── */
const LabelBuilder = {
  buildLabel(c, desi, tkg) {
    const page = document.createElement('div');
    page.className = 'label-page';

    // Desi/Weight display
    const desiVal  = desi.ucret !== null ? desi.ucret : '—';
    const kiloVal  = desi.kg    ? `${desi.kg} kg` : '—';
    const desiUnit = desi.kg > 20 && desi.ucret === desi.kg ? 'KG' : 'DESİ';

    // Company settings
    const co = State.company;
    const coName    = co.unvan   || 'ŞİRKET ÜNVANI';
    const coSlogan  = co.slogan  || '';
    const coAdres   = [co.adres, co.ilce, co.il].filter(Boolean).join(', ');
    const coTel     = co.telefon || '';
    const hasLogo   = !!co.logo;

    page.innerHTML = `
      <div class="label-inner">

        <!-- HEADER: Logo (Left) + Şirket Ünvanı (Right) -->
        <div class="label-header" style="align-items:center;">
          <div style="width: 32mm; height: 12mm; display:flex; align-items:center;">
            ${hasLogo
              ? `<img src="${co.logo}" style="max-height:12mm; max-width:32mm; object-fit:contain; display:block; filter: brightness(0);">`
              : ``
            }
          </div>
          <div style="flex-grow:1; text-align:right; overflow:hidden;">
            <div class="label-logo-text" style="font-family:'Oswald', sans-serif; font-weight:700;">${this.esc(coName)}</div>
            ${coSlogan ? `<div class="label-logo-sub" style="margin-top:1mm; font-family:'Oswald', sans-serif; font-weight:400;">${this.esc(coSlogan)}</div>` : ''}
          </div>
        </div>

        <!-- MIDDLE: Sender, Receiver & Barcode -->
        <div style="display: flex; flex-grow: 1;">
          
          <!-- Left Col (Sender + Receiver) -->
          <div style="flex-grow: 1; padding-right: 4mm; display: flex; flex-direction: column;">
            <!-- GÖNDERİCİ -->
            <div class="label-section">
              <div class="label-section-tag">
                <img src="gonderici.svg" style="width:10pt; height:10pt; margin-right:1mm; vertical-align:middle; display:inline-block;" />
                GÖNDERİCİ
              </div>
              <div class="label-sender-name">${this.esc(coName)}</div>
              ${coAdres ? `<div class="label-sender-addr">${this.esc(coAdres)}</div>` : ''}
              ${coTel   ? `<div class="label-sender-addr">${this.esc(coTel)}</div>` : ''}
            </div>
            
            <!-- ALICI -->
            <div class="label-section" style="flex-grow: 1; border-bottom: none; margin-bottom: 0; padding-bottom: 0;">
              <div class="label-section-tag">
                <img src="alici.svg" style="width:10pt; height:10pt; margin-right:1mm; vertical-align:middle; display:inline-block;" />
                Alıcı
              </div>
              <div class="label-recv-title">${this.esc(c.unvan)}</div>
              <div class="label-recv-contact">${this.esc(c.ad)} &nbsp;|&nbsp; ${this.esc(c.telefon)}</div>
              <div class="label-recv-addr">${this.esc(c.adres)}</div>
              <div class="label-recv-city">${this.esc(c.ilce)} / ${this.esc(c.il)}</div>
            </div>
          </div>
          
          <!-- Right Col (Barcode) -->
          <div style="width: 16mm; position: relative; flex-shrink: 0;">
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(90deg); display: flex; flex-direction: column; align-items: center; justify-content: center; width: 42mm;">
              <svg class="barcode-svg" data-value="${tkg}" style="width: 100% !important; height: auto !important; display:block; margin:0; padding:0;"></svg>
              <div style="font-family:monospace; font-size:6.5pt; color:#333; margin-top:1.5mm; text-align:center; line-height:1; letter-spacing:0.5px;">${tkg}</div>
            </div>
          </div>
          
        </div>

        <!-- KARGO BİLGİLERİ -->
        <div class="label-cargo-row">
          <div class="label-cargo-cell">
            <div class="label-cargo-val">${desiVal}</div>
            <div class="label-cargo-key">${desiUnit}</div>
          </div>
          <div class="label-cargo-sep"></div>
          <div class="label-cargo-cell">
            <div class="label-cargo-val">${kiloVal}</div>
            <div class="label-cargo-key">AĞIRLIK</div>
          </div>
          ${desi.en && desi.boy && desi.yuk ? `
          <div class="label-cargo-sep"></div>
          <div class="label-cargo-cell">
            <div class="label-cargo-val">${desi.en}×${desi.boy}×${desi.yuk}</div>
            <div class="label-cargo-key">ÖLÇÜLER (CM)</div>
          </div>` : ''}
        </div>

        <!-- BOTTOM: QR and Icons -->
        <div class="label-bottom" style="display:flex; justify-content:space-between; align-items:center; margin-top:auto; padding-top:2mm;">
          <!-- Left: QR -->
          <div style="display:flex; flex-direction:column; align-items:flex-start;">
            <div class="qrcode-div" data-value="https://www.tantex.com.tr" style="margin-bottom:1mm;"></div>
            <div style="font-family:monospace; font-size:6.5pt; color:#333; line-height:1;">www.tantex.com.tr</div>
          </div>
          
          <!-- Right: Packaging Icons -->
          <div style="display:flex; gap:2.5mm; align-items:center;">
            <!-- This Way Up -->
            <svg viewBox="0 0 100 100" style="width:11mm; height:11mm;">
              <rect x="5" y="5" width="90" height="90" rx="12" fill="none" stroke="#000" stroke-width="4"/>
              <rect x="18" y="70" width="64" height="8" fill="#000"/>
              <polygon points="34,22 18,46 27,46 27,66 41,66 41,46 50,46" fill="#000"/>
              <polygon points="66,22 50,46 59,46 59,66 73,66 73,46 82,46" fill="#000"/>
            </svg>
            <!-- Fragile -->
            <svg viewBox="0 0 100 100" style="width:11mm; height:11mm;">
              <rect x="5" y="5" width="90" height="90" rx="12" fill="none" stroke="#000" stroke-width="4"/>
              <path d="M 28 25 C 28 45 35 55 50 55 C 65 55 72 45 72 25 Z" fill="#000"/>
              <rect x="46" y="55" width="8" height="20" fill="#000"/>
              <path d="M 35 75 L 65 75 L 65 82 L 35 82 Z" fill="#000"/>
              <polygon points="56,23 44,38 54,38 42,50 48,50 60,34 50,34" fill="#fff"/>
            </svg>
            <!-- Keep Dry -->
            <svg viewBox="0 0 100 100" style="width:11mm; height:11mm;">
              <rect x="5" y="5" width="90" height="90" rx="12" fill="none" stroke="#000" stroke-width="4"/>
              <path d="M 15 52 C 15 10 85 10 85 52 Q 76.25 45 67.5 52 Q 58.75 45 50 52 Q 41.25 45 32.5 52 Q 23.75 45 15 52 Z" fill="#000"/>
              <path d="M 50 47 L 50 72 C 50 78 58 78 58 72" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/>
              <path d="M 38 12 Q 35 18 38 22 Q 41 18 38 12 Z" fill="#000"/>
              <path d="M 48 20 Q 45 26 48 30 Q 51 26 48 20 Z" fill="#000"/>
              <path d="M 60 14 Q 57 20 60 24 Q 63 20 60 14 Z" fill="#000"/>
            </svg>
          </div>
        </div>

      </div>
    `;
    return page;
  },

  esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

/* ────────────────────────────────────────
   APP — Customers & Modals
──────────────────────────────────────── */
const App = {
  openModal(id) {
    document.getElementById(id)?.classList.add('open');
  },
  closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  },

  initCities() {
    if (typeof TurkeyCities === 'undefined') return;
    const cities = Object.keys(TurkeyCities).sort((a, b) => a.localeCompare(b, 'tr'));
    
    const fillSelect = (id) => {
      const select = document.getElementById(id);
      if (!select) return;
      select.innerHTML = '<option value="">İl Seçiniz</option>';
      cities.forEach(city => {
        const opt = document.createElement('option');
        opt.value = city;
        opt.textContent = city;
        select.appendChild(opt);
      });
    };
    
    fillSelect('f-il');
    fillSelect('cf-il');
    fillSelect('cp-il');
  },

  handleCityChange(cityId, distId) {
    const citySelect = document.getElementById(cityId);
    const distSelect = document.getElementById(distId);
    if (!citySelect || !distSelect) return;
    
    const city = citySelect.value;
    distSelect.innerHTML = '<option value="">Önce İl Seçiniz</option>';
    
    if (!city || typeof TurkeyCities === 'undefined' || !TurkeyCities[city]) {
      distSelect.disabled = true;
      if (cityId === 'f-il') Slip.syncSummary();
      return;
    }
    
    distSelect.disabled = false;
    distSelect.innerHTML = '<option value="">İlçe Seçiniz</option>';
    
    let districts = [...TurkeyCities[city]];
    // Remove existing 'Merkez' if any, ignoring case
    districts = districts.filter(d => d.toLowerCase() !== 'merkez');
    // Sort alphabetically for Turkish locale
    districts.sort((a, b) => a.localeCompare(b, 'tr'));
    // Always add Merkez at the top
    districts.unshift('Merkez');
    
    districts.forEach(dist => {
      const opt = document.createElement('option');
      opt.value = dist;
      opt.textContent = dist;
      distSelect.appendChild(opt);
    });
    
    if (cityId === 'f-il') Slip.syncSummary();
  },

  showAlert(title, messageHtml) {
    let modal = document.getElementById('modal-alert');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = 'modal-alert';
      modal.innerHTML = `
        <div class="modal-box" style="max-width:380px;">
          <div class="modal-body" style="padding: 2rem 1.75rem; text-align:center;">
            <div style="width: 48px; height: 48px; background: var(--amber-bg); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem auto; color: var(--amber);">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:24px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 style="font-weight:700; font-size:1.15rem; margin-bottom:0.75rem; color: var(--text-main);" id="modal-alert-title"></h3>
            <p style="font-size: 0.95rem; color: var(--text-muted); line-height: 1.6;" id="modal-alert-message"></p>
          </div>
          <div class="modal-foot" style="justify-content:center; padding: 1.25rem;">
            <button class="btn btn-primary" style="min-width:120px;" onclick="App.closeModal('modal-alert')">Anladım</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    
    document.getElementById('modal-alert-title').textContent = title;
    document.getElementById('modal-alert-message').innerHTML = messageHtml;
    this.openModal('modal-alert');
  },

  showConfirm(title, messageHtml, onConfirmCallback) {
    let modal = document.getElementById('modal-confirm');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = 'modal-confirm';
      modal.innerHTML = `
        <div class="modal-box" style="max-width:400px;">
          <div class="modal-body" style="padding: 2rem 1.75rem; text-align:center;">
            <div style="width: 48px; height: 48px; background: var(--red-bg); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem auto; color: var(--red);">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:24px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 style="font-weight:700; font-size:1.15rem; margin-bottom:0.75rem; color: var(--text-main);" id="modal-confirm-title"></h3>
            <p style="font-size: 0.95rem; color: var(--text-muted); line-height: 1.6;" id="modal-confirm-message"></p>
          </div>
          <div class="modal-foot" style="justify-content:center; gap: 0.75rem; padding: 1.25rem;">
            <button class="btn btn-secondary" style="min-width:110px;" onclick="App.closeModal('modal-confirm')">İptal</button>
            <button class="btn btn-danger" style="min-width:110px;" id="modal-confirm-yes-btn">Evet, Sil</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    
    document.getElementById('modal-confirm-title').textContent = title;
    document.getElementById('modal-confirm-message').innerHTML = messageHtml;
    
    const yesBtn = document.getElementById('modal-confirm-yes-btn');
    yesBtn.onclick = () => {
      this.closeModal('modal-confirm');
      if (onConfirmCallback) onConfirmCallback();
    };
    
    this.openModal('modal-confirm');
  },

  /* ── Customer Picker Modal ── */
  openCustomerPicker() {
    document.getElementById('picker-search').value = '';
    this.renderPickerList(State.customers);
    this.openModal('modal-customer-picker');
  },

  filterPickerList() {
    const q = document.getElementById('picker-search').value.toLowerCase();
    const filtered = State.customers.filter(c =>
      c.unvan.toLowerCase().includes(q) ||
      c.ad.toLowerCase().includes(q) ||
      c.telefon.includes(q)
    );
    this.renderPickerList(filtered);
  },

  renderPickerList(list) {
    const ul = document.getElementById('picker-list');
    ul.innerHTML = '';
    if (list.length === 0) {
      ul.innerHTML = '<li style="padding:1.5rem; text-align:center; color:var(--text-muted);">Sonuç bulunamadı.</li>';
      return;
    }
    list.forEach(cust => {
      const li = document.createElement('li');
      li.className = 'cust-list-item';
      li.innerHTML = `
        <div>
          <div class="item-name">${cust.unvan}</div>
          <div class="item-sub">${cust.ad} · ${cust.telefon} · ${cust.ilce || ''}/${cust.il || ''}</div>
        </div>
        <span class="item-code">${cust.kod || ''}</span>
      `;
      li.onclick = () => this.selectCustomer(cust);
      ul.appendChild(li);
    });
  },

  selectCustomer(cust) {
    State.selectedCustomer = cust;
    Slip.fillFromCustomer(cust);

    // Update badge
    document.getElementById('badge-name-text').textContent = cust.unvan;
    document.getElementById('badge-code-text').textContent = `${cust.kod || ''}  ${cust.ilce || ''} / ${cust.il || ''}`;
    document.getElementById('selected-customer-badge').style.display = 'flex';
    document.getElementById('open-customer-picker-btn').style.display = 'none';

    this.closeModal('modal-customer-picker');
  },

  /* ── Save Prompt (yeni müşteri) ── */
  handleSavePrompt(shouldSave) {
    this.closeModal('modal-save-prompt');
    const data = State.pendingPrintData;
    if (!data) return;

    let savedCust = null;
    if (shouldSave) {
      // Save customer to list
      const c = data.formData;
      savedCust = {
        id: 'cust-' + Date.now(),
        unvan: c.unvan, ad: c.ad, telefon: c.telefon,
        adres: c.adres, ilce: c.ilce, il: c.il,
        kod: 'M-' + (State.customers.length + 10001),
      };
      State.customers.push(savedCust);
      Store.saveCustomers();
    }

    Slip.executePrint(data);
    State.pendingPrintData = null;

    // After printing, if saved → silently switch to saved mode without clearing the form.
    // This prevents the save prompt from appearing again on subsequent prints.
    if (savedCust) {
      State.mode = 'saved';
      State.selectedCustomer = savedCust;

      // Update UI cards
      const newCard   = document.getElementById('mode-new-card');
      const savedCard = document.getElementById('mode-saved-card');
      const savedArea = document.getElementById('saved-customer-select-area');
      if (newCard)   newCard.classList.remove('selected');
      if (savedCard) savedCard.classList.add('selected');
      if (savedArea) savedArea.style.display = 'block';

      // Show the customer badge
      const badge     = document.getElementById('selected-customer-badge');
      const pickerBtn = document.getElementById('open-customer-picker-btn');
      if (badge) {
        document.getElementById('badge-name-text').textContent = savedCust.unvan;
        document.getElementById('badge-code-text').textContent = `${savedCust.kod || ''}  ${savedCust.ilce || ''} / ${savedCust.il || ''}`;
        badge.style.display = 'flex';
      }
      if (pickerBtn) pickerBtn.style.display = 'none';
      // Form inputs are left untouched — user can print again immediately
    }
  },

  /* ── Customer CRUD Table ── */
  renderCustomersTable(list) {
    const tbody = document.getElementById('customers-tbody');
    if (!tbody) return;
    const data = list || State.customers;
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Kayıtlı müşteri bulunamadı.</td></tr>`;
      return;
    }

    data.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="code-badge">${c.kod || '—'}</span></td>
        <td>
          <div class="cell-stack">
            <span class="cell-main">${c.unvan}</span>
          </div>
        </td>
        <td>${c.ad}</td>
        <td>${c.telefon}</td>
        <td>
          <div class="cell-stack">
            <span class="cell-main">${c.il || '—'}</span>
            <span class="cell-sub">${c.ilce || ''}</span>
          </div>
        </td>
        <td>
          <div class="action-group">
            <button class="action-btn btn-use" title="Fişte Kullan" onclick="App.useInSlip('${c.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
            </button>
            <button class="action-btn btn-edit" title="Düzenle" onclick="App.openCustomerModal('${c.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"/></svg>
            </button>
            <button class="action-btn btn-del" title="Sil" onclick="App.deleteCustomer('${c.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.24 2.156H8.584a2.25 2.25 0 01-2.24-2.156L5.61 5.757m12.73 0c.34-.059.68-.114 1.022-.165M18.004 4.087a48.86 48.86 0 00-12.01 0m11.958 0c.515.057.994.254 1.37.591m-1.553-.591a48.908 48.908 0 00-9.334 0M4.505 4.087c-.376.337-.655.735-.785 1.19m11.1-1.19c-.48-.052-.962-.087-1.446-.105m-8.2.137c-.482-.018-.965-.053-1.446-.105M8.5 2.25h7a1.125 1.125 0 011.125 1.125v1.25H7.375V3.375A1.125 1.125 0 018.5 2.25z"/></svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  filterCustomers() {
    const q = document.getElementById('customer-search').value.toLowerCase();
    const filtered = State.customers.filter(c =>
      c.unvan.toLowerCase().includes(q) ||
      c.ad.toLowerCase().includes(q) ||
      c.telefon.includes(q) ||
      (c.il || '').toLowerCase().includes(q) ||
      (c.ilce || '').toLowerCase().includes(q)
    );
    this.renderCustomersTable(filtered);
  },

  useInSlip(id) {
    const cust = State.customers.find(c => c.id === id);
    if (!cust) return;
    window.location.hash = '#/slip';
    setTimeout(() => {
      Slip.setMode('saved');
      App.selectCustomer(cust);
    }, 80);
  },

  /* ── Customer Form Modal ── */
  openCustomerModal(id) {
    const form = document.getElementById('cust-form');
    form.reset();
    document.getElementById('cust-form-id').value = '';
    document.getElementById('cust-modal-title').textContent = 'Yeni Müşteri Ekle';
    document.getElementById('cust-form-submit').textContent = 'Kaydet';

    if (id) {
      const c = State.customers.find(x => x.id === id);
      if (!c) return;
      document.getElementById('cust-form-id').value = c.id;
      document.getElementById('cf-unvan').value = c.unvan || '';
      document.getElementById('cf-ad').value    = c.ad    || '';
      document.getElementById('cf-tel').value   = c.telefon || '';
      document.getElementById('cf-adres').value = c.adres || '';
      document.getElementById('cf-kod').value   = c.kod   || '';
      
      const ilSelect = document.getElementById('cf-il');
      ilSelect.value = c.il || '';
      this.handleCityChange('cf-il', 'cf-ilce');
      document.getElementById('cf-ilce').value  = c.ilce  || '';
      
      document.getElementById('cust-modal-title').textContent = 'Müşteriyi Düzenle';
      document.getElementById('cust-form-submit').textContent = 'Güncelle';
    } else {
      // Clear city and reset district for new customer
      document.getElementById('cf-il').value = '';
      this.handleCityChange('cf-il', 'cf-ilce');
    }

    this.openModal('modal-customer-form');
  },

  async handleCustomerSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('cust-form-id').value;
    const data = {
      unvan:   document.getElementById('cf-unvan').value.trim(),
      ad:      document.getElementById('cf-ad').value.trim(),
      telefon: document.getElementById('cf-tel').value.trim(),
      adres:   document.getElementById('cf-adres').value.trim(),
      ilce:    document.getElementById('cf-ilce').value.trim(),
      il:      document.getElementById('cf-il').value.trim(),
      kod:     document.getElementById('cf-kod').value.trim(),
    };

    if (id) {
      data.id = id;
      const idx = State.customers.findIndex(c => c.id === id);
      if (idx !== -1) State.customers[idx] = { ...State.customers[idx], ...data };
    } else {
      data.id  = 'cust-' + Date.now();
      data.kod = data.kod || ('M-' + (State.customers.length + 10001));
      State.customers.unshift(data); // Add to top locally
    }

    // Use specific Store method instead of saveCustomers
    await Store.saveCustomer(data);
    
    this.closeModal('modal-customer-form');
    this.renderCustomersTable();
  },

  deleteCustomer(id) {
    const c = State.customers.find(x => x.id === id);
    if (!c) return;
    
    this.showConfirm(
      'Müşteriyi Sil',
      `<b style="color:var(--text-main);">${c.unvan}</b> müşterisini kalıcı olarak silmek istediğinizden emin misiniz?`,
      async () => {
        State.customers = State.customers.filter(x => x.id !== id);
        await Store.deleteCustomer(id);
        this.renderCustomersTable();
      }
    );
  },

  /* ── Company Profile ── */
  renderCompanyForm() {
    const co = State.company;
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };
    setVal('cp-unvan',   co.unvan);
    setVal('cp-slogan',  co.slogan);
    setVal('cp-tel',     co.telefon);
    setVal('cp-adres',   co.adres);
    
    setVal('cp-il',      co.il);
    this.handleCityChange('cp-il', 'cp-ilce');
    setVal('cp-ilce',    co.ilce);

    // Show logo preview
    const preview = document.getElementById('cp-logo-preview');
    if (preview) {
      preview.src = co.logo || '';
      preview.style.display = co.logo ? 'block' : 'none';
    }
  },

  /* ── Auth ── */
  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const btn = document.querySelector('.login-btn');
    
    errorEl.style.display = 'none';
    const oldText = btn.innerHTML;
    btn.innerHTML = 'Giriş Yapılıyor...';
    btn.disabled = true;

    try {
      if (!_db) throw new Error('Sunucu bağlantısı yok (localStorage modunda auth kullanılamaz).');
      const { data, error } = await _db.auth.signInWithPassword({ email, password });
      
      if (error) {
        throw error;
      }
      
      State.session = data.session;
      // Navigate to app
      Router.navigate('#/slip');
      
    } catch (err) {
      console.error(err);
      errorEl.textContent = err.message || 'Giriş başarısız. Lütfen bilgilerinizi kontrol edin.';
      errorEl.style.display = 'block';
    } finally {
      btn.innerHTML = oldText;
      btn.disabled = false;
    }
  },

  handleLogoUpload(input) {
    const file = input.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        App.showAlert('Hata', 'Logo dosyası 2 MB\'dan büyük olamaz.');
        input.value = '';
        return;
      }
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      State.company.logo = e.target.result;
      const preview = document.getElementById('cp-logo-preview');
      if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
  },

  removeCompanyLogo() {
    State.company.logo = '';
    const preview = document.getElementById('cp-logo-preview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    const inp = document.getElementById('cp-logo-input');
    if (inp) inp.value = '';
  },

  async saveCompanySettings() {
    const getVal = (id) => (document.getElementById(id)?.value?.trim() || '');
    State.company.unvan   = getVal('cp-unvan');
    State.company.slogan  = getVal('cp-slogan');
    State.company.telefon = getVal('cp-tel');
    State.company.adres   = getVal('cp-adres');
    State.company.ilce    = getVal('cp-ilce');
    State.company.il      = getVal('cp-il');
    // logo already updated via handleLogoUpload
    await Store.saveCompany();

    // Visual feedback
    const btn = document.getElementById('cp-save-btn');
    if (btn) {
      btn.textContent = '✓ Kaydedildi!';
      btn.disabled = true;
      setTimeout(() => { btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:17px"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.046 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.14.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/></svg> Bilgileri Kaydet'; btn.disabled = false; }, 2000);
    }
  },
};

/* ────────────────────────────────────────
   FLOATING MENU LOGIC
──────────────────────────────────────── */
const Dock = {
  NORMAL:  48,   // px – base icon size
  MAX:     72,   // px – max icon size on hover
  DIST:   140,   // px – influence radius

  init() {
    this.panel = document.getElementById('dock-panel');
    if (!this.panel) return;
    this.items = Array.from(this.panel.querySelectorAll('.dock-item'));

    this.panel.addEventListener('mousemove', (e) => this._onMove(e));
    this.panel.addEventListener('mouseleave', () => this._onLeave());

    this.updateActive();
  },

  _onMove(e) {
    const mouseX = e.clientX;
    this.items.forEach(item => {
      const rect = item.querySelector('.dock-icon').getBoundingClientRect();
      const iconCenterX = rect.left + rect.width / 2;
      const dist = Math.abs(mouseX - iconCenterX);
      // Gaussian-like falloff
      const ratio = Math.max(0, 1 - dist / this.DIST);
      const size = Math.round(this.NORMAL + (this.MAX - this.NORMAL) * ratio);
      this._setSize(item, size);
    });
  },

  _onLeave() {
    this.items.forEach(item => this._setSize(item, this.NORMAL));
  },

  _setSize(item, size) {
    const icon = item.querySelector('.dock-icon');
    const svg  = item.querySelector('svg');
    if (!icon) return;

    // Scale the icon square
    icon.style.width        = size + 'px';
    icon.style.height       = size + 'px';
    icon.style.borderRadius = Math.round(size * 0.26) + 'px';

    // Also widen the button wrapper so icons never overflow and overlap
    // Add 8px horizontal breathing room on each side
    item.style.width = (size + 8) + 'px';

    // Scale SVG proportionally
    if (svg) {
      const svgSize = Math.round(size * 0.48);
      svg.style.width  = svgSize + 'px';
      svg.style.height = svgSize + 'px';
    }
  },

  updateActive() {
    // Default to login until auth is verified
    const hash = window.location.hash || '#/login';
    const map = {
      '#/login':     'view-login',
      '#/slip':      'view-slip',
      '#/customers': 'view-customers',
      '#/company':   'view-company',
    };
    
    // Set view pane active
    document.querySelectorAll('.view-pane').forEach(el => el.classList.remove('active'));
    const activeViewId = Object.keys(map).find(k => hash.startsWith(k));
    if (activeViewId) {
      const el = document.getElementById(map[activeViewId]);
      if (el) el.classList.add('active');
    }

    // Set dock active
    this.items.forEach(item => item.classList.remove('active'));
    const dockMap = {
      '#/slip':      'dock-slip',
      '#/customers': 'dock-customers',
      '#/company':   'dock-company',
    };
    const activeDockId = Object.keys(dockMap).find(k => hash.startsWith(k));
    if (activeDockId) {
      const el = document.getElementById(dockMap[activeDockId]);
      if (el) el.classList.add('active');
    }

    // Hide/show dock
    const dockWrapper = document.getElementById('dock-wrapper');
    if (dockWrapper) {
      if (hash.startsWith('#/login')) {
        dockWrapper.style.display = 'none';
        document.body.style.paddingBottom = '0'; // Remove dock padding
      } else {
        dockWrapper.style.display = '';
        document.body.style.paddingBottom = '';
      }
    }
  },

  navigate(hash) {
    window.location.hash = hash;
    this.updateActive();
  }
};

/* ────────────────────────────────────────
   BOOTSTRAP
──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // ── 1. UI'yı ANINDA başlat (Supabase'i bekleme) ──
  App.initCities();
  Router.init();
  TKG.setInputValue();
  Slip.syncSummary();
  Dock.init();

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Expose to window for inline handlers
  window.App  = App;
  window.Slip = Slip;
  window.Dock = Dock;

  // ── 2. Auth Control & Verileri ARKA PLANDA yükle (UI'yı bloke etme) ──
  const checkAuthAndLoad = async () => {
    if (_db) {
      const { data: { session } } = await _db.auth.getSession();
      State.session = session;
      if (!session) {
        Router.navigate('#/login');
        return; // Don't load data if not logged in
      } else {
        if (window.location.hash.startsWith('#/login') || !window.location.hash) {
          Router.navigate('#/slip');
        }
      }
    }
    
    // Logged in or local mode -> load data
    Store.load().then(() => {
      // Data geldi, ilgili görünümü güncelle
      TKG.setInputValue();
      Slip.syncSummary();
  
      const hash = window.location.hash;
      if (hash.includes('/customers')) App.renderCustomersTable();
      if (hash.includes('/company'))   App.renderCompanyForm();
    }).catch(err => {
      console.error('Veri yüklenemedi:', err);
    });
  };
  
  // Expose Router to window so LoginPage can use it
  window.Router = Router;

  checkAuthAndLoad();
  LoginPage.init();
});

/* ────────────────────────────────────────
   LOGIN PAGE — Vanilla JS Module
   (Full faithful recreation of Login.jsx)
──────────────────────────────────────── */
const LoginPage = {
  mouse: { x: 0, y: 0 },
  state: {
    purpleBlinking: false,
    blackBlinking:  false,
    isTyping:       false,
    pwFocused:      false,
    pwValue:        '',
    pwVisible:      false,
  },

  init() {
    // Global mouse move (RAF throttled)
    let ticking = false;
    window.addEventListener('mousemove', (e) => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this.mouse.x = e.clientX;
          this.mouse.y = e.clientY;
          this.updateEyes();
          ticking = false;
        });
        ticking = true;
      }
    });

    // Blink schedulers
    this._schedBlink('purple');
    this._schedBlink('black');
  },

  _schedBlink(which) {
    const key = which === 'purple' ? 'purpleBlinking' : 'blackBlinking';
    const delay = Math.random() * 4000 + 3000;
    setTimeout(() => {
      this.state[key] = true;
      this.updateEyes();
      setTimeout(() => {
        this.state[key] = false;
        this.updateEyes();
        this._schedBlink(which);
      }, 150);
    }, delay);
  },

  /* Eye position calculation */
  _calcPupilOffset(el, maxDist) {
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = this.mouse.x - cx;
    const dy = this.mouse.y - cy;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
    const angle = Math.atan2(dy, dx);
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
  },

  _setEye(id, pupilId, opts) {
    const eye = document.getElementById(id);
    const pupil = document.getElementById(pupilId);
    if (!eye || !pupil) return;

    if (opts.blink) {
      eye.style.height = '2px';
    } else {
      eye.style.height = '';
    }

    if (opts.forcePupil) {
      pupil.style.transform = `translate(${opts.forcePupil.x}px, ${opts.forcePupil.y}px)`;
    } else {
      const pos = this._calcPupilOffset(eye, opts.maxDist || 5);
      pupil.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    }
  },

  updateEyes() {
    const { purpleBlinking, blackBlinking, isTyping, pwFocused, pwValue, pwVisible } = this.state;
    const shouldClose   = pwFocused && !pwVisible;
    const pwHidden      = pwValue && pwValue.length > 0 && !pwVisible;
    const pwVisibleMode = pwValue && pwValue.length > 0 && pwVisible;

    const purpleBlink = purpleBlinking || shouldClose;
    const blackBlink  = blackBlinking  || shouldClose;
    const otherClose  = shouldClose;

    // Purple eyes
    const pForce = pwVisibleMode ? { x: -4, y: -4 } : isTyping ? { x: 3, y: 4 } : null;
    this._setEye('ep1', 'ep1p', { blink: purpleBlink, forcePupil: pForce, maxDist: 5 });
    this._setEye('ep2', 'ep2p', { blink: purpleBlink, forcePupil: pForce, maxDist: 5 });

    // Purple character lean when typing / pw hidden
    const purple = document.getElementById('char-purple');
    if (purple) {
      if (pwVisibleMode) {
        purple.style.transform = 'skewX(0deg)';
        purple.style.height = '360px';
      } else if (pwHidden || isTyping) {
        purple.style.transform = 'skewX(-12deg) translateX(40px)';
        purple.style.height = '400px';
      } else {
        purple.style.transform = '';
        purple.style.height = '360px';
      }
    }

    // Black eyes
    const bForce = pwVisibleMode ? { x: -4, y: -4 } : isTyping ? { x: 0, y: -4 } : null;
    this._setEye('eb1', 'eb1p', { blink: blackBlink, forcePupil: bForce, maxDist: 4 });
    this._setEye('eb2', 'eb2p', { blink: blackBlink, forcePupil: bForce, maxDist: 4 });

    // Black lean when typing
    const black = document.getElementById('char-black');
    if (black) {
      if (pwVisibleMode) {
        black.style.transform = 'skewX(0deg)';
      } else if (isTyping || pwHidden) {
        black.style.transform = 'skewX(15deg) translateX(20px)';
      } else {
        black.style.transform = '';
      }
    }

    // Orange eyes
    const oForce = pwVisibleMode ? { x: -5, y: -4 } : null;
    this._setEye('eo1', 'eo1p', { blink: otherClose, forcePupil: oForce, maxDist: 3 });
    this._setEye('eo2', 'eo2p', { blink: otherClose, forcePupil: oForce, maxDist: 3 });

    // Yellow eyes
    const yForce = pwVisibleMode ? { x: -5, y: -4 } : null;
    this._setEye('ey1', 'ey1p', { blink: otherClose, forcePupil: yForce, maxDist: 3 });
    this._setEye('ey2', 'ey2p', { blink: otherClose, forcePupil: yForce, maxDist: 3 });
  },

  /* Form event handlers */
  onEmailFocus()    { this.state.isTyping = true;   this.updateEyes(); },
  onEmailBlur()     { this.state.isTyping = false;  this.updateEyes(); },
  onPasswordFocus() { this.state.pwFocused = true;  this.updateEyes(); },
  onPasswordBlur()  { this.state.pwFocused = false; this.updateEyes(); },
  onPasswordInput() {
    this.state.pwValue = document.getElementById('login-password')?.value || '';
    this.updateEyes();
  },

  togglePassword() {
    const inp = document.getElementById('login-password');
    const showIcon = document.getElementById('eye-icon-show');
    const hideIcon = document.getElementById('eye-icon-hide');
    if (!inp) return;
    const visible = inp.type === 'text';
    inp.type = visible ? 'password' : 'text';
    showIcon.style.display = visible ? '' : 'none';
    hideIcon.style.display = visible ? 'none' : '';
    this.state.pwVisible = !visible;
    this.updateEyes();
  },

  /* Forgot Password */
  showForgot() {
    const m = document.getElementById('forgot-modal');
    if (m) { m.style.display = 'flex'; document.getElementById('forgot-email').value = ''; this._resetForgotStatus(); }
  },

  hideForgot() {
    const m = document.getElementById('forgot-modal');
    if (m) m.style.display = 'none';
  },

  closeForgotOnOverlay(e) {
    if (e.target === document.getElementById('forgot-modal')) this.hideForgot();
  },

  _resetForgotStatus() {
    document.getElementById('forgot-success').style.display = 'none';
    document.getElementById('forgot-notfound').style.display = 'none';
  },

  searchForgot() {
    const email = document.getElementById('forgot-email')?.value?.trim();
    if (!email) return;
    const btn = document.getElementById('forgot-search-btn');
    btn.disabled = true;
    btn.textContent = 'Sorgulanıyor...';
    this._resetForgotStatus();

    // Always show "request received" for security (never reveal if email exists)
    setTimeout(() => {
      document.getElementById('forgot-success').style.display = 'flex';
      btn.disabled = false;
      btn.textContent = 'Sorgula';
    }, 800);
  },

  /* Form Submit */
  async handleSubmit(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email')?.value?.trim();
    const password = document.getElementById('login-password')?.value;
    const errorEl  = document.getElementById('login-error');
    const btn      = document.getElementById('login-submit-btn');

    // Validate
    let valid = true;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('email-error').textContent = 'Geçerli bir e-posta giriniz.';
      document.getElementById('email-error').style.display = 'block';
      document.getElementById('login-email').classList.add('error');
      valid = false;
    } else {
      document.getElementById('email-error').style.display = 'none';
      document.getElementById('login-email').classList.remove('error');
    }
    if (!password) {
      document.getElementById('password-error').textContent = 'Şifre zorunludur.';
      document.getElementById('password-error').style.display = 'block';
      document.getElementById('login-password').classList.add('error');
      valid = false;
    } else {
      document.getElementById('password-error').style.display = 'none';
      document.getElementById('login-password').classList.remove('error');
    }
    if (!valid) return;

    errorEl.style.display = 'none';
    const origHTML = btn.innerHTML;
    btn.innerHTML = '<svg class="lp-spin" style="width:18px;height:18px;margin-right:6px" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" style="opacity:.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" style="opacity:.75"/></svg>Giriş yapılıyor...';
    btn.disabled = true;

    try {
      if (!_db) throw new Error('Sunucu bağlantısı kurulamadı.');
      const { data, error } = await _db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      State.session = data.session;
      window.Router.navigate('#/slip');
    } catch (err) {
      errorEl.textContent = err.message === 'Invalid login credentials'
        ? 'E-posta veya şifre hatalı. Lütfen tekrar deneyiniz.'
        : (err.message || 'Giriş başarısız.');
      errorEl.style.display = 'block';
    } finally {
      btn.innerHTML = origHTML;
      btn.disabled = false;
    }
  }
};

window.LoginPage = LoginPage;


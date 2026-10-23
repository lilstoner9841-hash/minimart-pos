// แอปหน้าร้าน: ล็อกอิน → หน้าขายทันที · ฟีเจอร์อื่นอยู่ในเมนู ☰
(function () {
  'use strict';
  const C = window.APP_CONFIG;
  const I = window.I18N;
  const LS = C.storageKey;
  let db;

  const S = {
    me: null, lang: pref('lang', C.defaultLang), cur: 'LAK', settings: {}, products: [], costs: {},
    cart: [], cat: 'all', q: '', page: 'pos', shift: null, pay: null, sheet: false,
    customers: [], recv: { rows: [], supplier: '', note: '' }, cod: null, codFilter: 'open',
    histDate: null, month: null, edit: null,
  };

  // ------------------------------------------------------------ helpers
  function pref(k, def) { try { return localStorage.getItem(LS + ':' + k) || def; } catch (e) { return def; } }
  function setPref(k, v) { try { localStorage.setItem(LS + ':' + k, v); } catch (e) { /* private mode */ } }
  const $ = s => document.querySelector(s);
  const t = (k, vars) => {
    let s = (I[S.lang] && I[S.lang][k]) || I.th[k] || k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b);
    return s;
  };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // เงินพิมพ์/แสดงแบบมีจุดคั่นหลักพัน: 10000 → 10.000 · num() อ่านกลับโดยตัดจุดทิ้ง (จำนวนเต็มเท่านั้น)
  const fmtNum = v => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const num = v => { const s = String(v == null ? '' : v).replace(/[^\d-]/g, ''); const n = Number(s); return s && isFinite(n) ? n : 0; };
  // อัตราแลกเปลี่ยนมีทศนิยมได้ (เช่น 652.5) จึงอ่านแยก
  const dec = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const rate = () => dec(S.settings.rate_thb);
  const lak = v => fmtNum(v) + ' ₭';
  const thb = v => fmtNum(v) + ' ฿';
  // จัดรูปแบบช่องเงินระหว่างพิมพ์ โดยไม่ให้เคอร์เซอร์กระโดด
  function formatMoneyInput(el, ev) {
    let raw = el.value;
    let pos = el.selectionStart == null ? raw.length : el.selectionStart;
    const prev = el._prevMoney == null ? raw : el._prevMoney;
    // กด Backspace/Delete โดนจุดพอดี → ลบตัวเลขที่อยู่ติดกันแทน (ไม่อย่างนั้นจุดจะเด้งกลับ และลบไม่ไป)
    if (ev && /^delete/.test(ev.inputType || '') && raw.replace(/\D/g, '') === prev.replace(/\D/g, '') && raw.length === prev.length - 1) {
      if (ev.inputType === 'deleteContentBackward' && pos > 0) { raw = raw.slice(0, pos - 1) + raw.slice(pos); pos -= 1; }
      else if (ev.inputType === 'deleteContentForward') raw = raw.slice(0, pos) + raw.slice(pos + 1);
    }
    const digitsBefore = raw.slice(0, pos).replace(/\D/g, '').length;
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const out = digits ? fmtNum(digits) : '';
    el._prevMoney = out;
    if (out === el.value) return;
    el.value = out;
    let i = 0, seen = 0;
    while (i < out.length && seen < digitsBefore) { if (out[i] !== '.') seen++; i++; }
    try { el.setSelectionRange(i, i); } catch (e) { /* input type without selection */ }
  }
  const money0 = v => (v === '' || v == null ? '' : fmtNum(v));
  const money = v => (S.cur === 'THB' && rate() > 0 ? thb(v / rate()) : lak(v));
  const isOwner = () => !!S.me && S.me.role === 'owner';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayRange = s => { const [y, m, d] = s.split('-').map(Number); return [new Date(y, m - 1, d).toISOString(), new Date(y, m - 1, d + 1).toISOString()]; };
  const monthRange = s => { const [y, m] = s.split('-').map(Number); return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString(), fromDate: `${y}-${pad(m)}-01`, toDate: ymd(new Date(y, m, 1)) }; };
  const hhmm = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dmy = iso => new Date(iso).toLocaleDateString('en-GB');
  const shortId = id => String(id).slice(0, 6).toUpperCase();
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const prodById = id => S.products.find(p => p.id === id);

  const PALETTE = [['#FAEEDA', '#633806'], ['#E1F5EE', '#085041'], ['#FAECE7', '#712B13'], ['#EEEDFE', '#3C3489'], ['#FBEAF0', '#72243E'], ['#EAF3DE', '#27500A'], ['#E6F1FB', '#0C447C']];
  // สีตามลำดับหมวด (ไม่ใช้ hash) เพื่อให้หมวดที่อยู่ติดกันสีไม่ซ้ำกัน
  let catMemo = { list: null, cats: [] };
  function catColor(c) {
    if (catMemo.list !== S.products) catMemo = { list: S.products, cats: [...new Set(S.products.map(p => p.category).filter(Boolean))].sort() };
    const i = catMemo.cats.indexOf(c);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }
  function thumb(p, cls) {
    const [bg, fg] = catColor(p.category);
    if (p.image_url) return `<div class="${cls}" style="background:${bg}"><img src="${esc(p.image_url)}" alt="" loading="lazy"></div>`;
    return `<div class="${cls}" style="background:${bg};color:${fg}">${esc(Array.from(p.name).slice(0, 2).join(''))}</div>`;
  }

  function errMsg(e) {
    if (e instanceof window.AppError) {
      const map = { bad_login: 'loginErr', no_shift: 'needShift', pick_customer: 'pickCustomer', dup_barcode: 'dupBarcode', need_customer: 'needCustomer', empty_cart: 'needItems' };
      if (map[e.code]) return t(map[e.code]);
      if (I.th[e.code]) return t(e.code, { d: e.detail });
      return t('generic', { d: e.detail || e.code });
    }
    console.error(e);
    return t('generic', { d: e && e.message });
  }
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), kind === 'err' ? 5000 : 2600);
  }
  let actx;
  function beep(ok) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = ok ? 1200 : 220; g.gain.value = 0.08;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + (ok ? 0.07 : 0.25));
    } catch (e) { /* no audio */ }
  }
  async function withBusy(btn, fn) {
    if (btn && btn.getAttribute('aria-busy') === 'true') return;
    if (btn) btn.setAttribute('aria-busy', 'true');
    try { return await fn(); } catch (e) { toast(errMsg(e), 'err'); beep(false); } finally { if (btn) btn.removeAttribute('aria-busy'); }
  }
  const scripts = {};
  function loadScript(src) {
    scripts[src] = scripts[src] || new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error('load ' + src)); }; document.head.append(s); });
    return scripts[src];
  }
  const LIB = {
    barcode: 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js',
    qr: 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  };

  // ------------------------------------------------------------ boot
  async function boot() {
    document.documentElement.lang = S.lang;
    try { db = window.createDB(C); } catch (e) { $('#app').innerHTML = `<div class="fatal">${esc(e.message)}</div>`; return; }
    try { S.me = await db.session(); } catch (e) { S.me = null; }
    if (S.me) await loadCore();
    render();
    window.addEventListener('online', () => { $('#offline') && ($('#offline').hidden = true); });
    window.addEventListener('offline', () => { $('#offline') && ($('#offline').hidden = false); });
    window.addEventListener('focus', () => { if (S.me && S.page === 'pos' && !S.pay) refreshProducts().then(drawPos).catch(() => {}); });
    setInterval(() => { if (S.me && S.page === 'pos' && !S.pay && navigator.onLine) refreshProducts().then(drawPos).catch(() => {}); }, 60000);
  }
  async function loadCore() {
    const [settings, shift] = await Promise.all([db.getSettings(), db.currentShift()]);
    S.settings = settings; S.shift = shift;
    await refreshProducts();
  }
  async function refreshProducts() {
    // พนักงานเห็นราคาซื้อด้วย (ต้องใช้ตอนกรอกสินค้าเข้า)
    [S.products, S.costs] = await Promise.all([db.listProducts(), db.listCosts()]);
  }

  // ------------------------------------------------------------ shell
  // หน้า "รายจ่าย" ยังไม่เปิดใช้ (จะย้ายไปทำในระบบหลังบ้าน) ตาราง expenses ในฐานข้อมูลยังเก็บไว้
  const PAGES = [
    ['pos', 'ti-shopping-cart', false], ['cod', 'ti-truck-delivery', false], ['receive', 'ti-package-import', false],
    ['products', 'ti-tag', false], ['labels', 'ti-barcode', false],
    ['stock', 'ti-packages', false], ['debts', 'ti-notebook', false], ['history', 'ti-receipt', false], ['shift', 'ti-cash-register', false],
    ['reports', 'ti-chart-bar', true], ['settings', 'ti-settings', true],
  ];

  // ขนส่ง: โลโก้อยู่ที่ assets/couriers/ ถ้าไม่มีไฟล์จะแสดงป้ายสีแทน
  const COURIERS = [
    { id: 'Mixay Express', short: 'MX', logo: 'assets/couriers/mixay.jpg', bg: '#E6F1FB', fg: '#0C447C' },
    { id: 'HAL Express', sub: 'ຮຸ່ງອາລຸນ', short: 'HAL', logo: 'assets/couriers/hal.png', bg: '#FCEBEB', fg: '#A32D2D' },
    { id: 'Unitel Logistics', short: 'U', logo: 'assets/couriers/unitel.png', bg: '#FAEEDA', fg: '#854F0B' },
  ];
  const courierLogo = (c, cls) => `<span class="${cls}" style="background:${c.bg};color:${c.fg}"><b>${c.short}</b><img src="${c.logo}" alt="" onerror="this.remove()"></span>`;
  function courierTiles(selected, act) {
    return `<div class="couriers">${COURIERS.map(c => `<button type="button" class="courier ${selected === c.id ? 'on' : ''}" data-act="${act}" data-v="${esc(c.id)}" aria-pressed="${selected === c.id}">
      ${courierLogo(c, 'clogo')}<span class="cnm">${esc(c.id)}${c.sub ? `<small>${c.sub}</small>` : ''}</span><i class="ti ti-circle-check ccheck"></i></button>`).join('')}</div>`;
  }
  function selectCourierTile(box, value) {
    box.querySelectorAll('.courier').forEach(b => {
      const on = b.dataset.v === value;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
      if (on) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    });
    if (value) beep(true);
  }
  function courierBadge(name) {
    if (!name) return '';
    const c = COURIERS.find(x => x.id === name);
    return c ? `<span class="cbadge">${courierLogo(c, 'clogo sm')}${esc(c.id)}</span>` : `<span class="tag">${esc(name)}</span>`;
  }
  function render() {
    if (!S.me) return renderLogin();
    const low = S.products.filter(p => p.active !== false && p.stock <= p.min_stock).length;
    const shop = S.settings.shop_name || C.shopName;
    $('#app').innerHTML = `
      ${db.mode === 'demo' ? `<div class="demo-bar">${t('demoBar')}</div>` : ''}
      <div id="offline" class="offline-bar" ${navigator.onLine ? 'hidden' : ''}>${t('offline')}</div>
      <header class="top">
        <button class="icon-btn" data-act="menu" aria-label="${t('menu')}"><i class="ti ti-menu-2"></i></button>
        ${C.logo ? `<img class="brand-logo" src="${esc(C.logo)}" alt="">` : ''}
        <div class="brand"><b>${esc(shop)}</b><small>${t(S.page)}</small></div>
        <div class="top-right">
          <button class="pill ${S.shift ? 'ok' : 'warn'}" data-act="go" data-page="shift">${S.shift ? '● ' + t('open') : t('needShift')}</button>
          <div class="seg sm">${['LAK', 'THB'].map(c => `<button class="${S.cur === c ? 'on' : ''}" data-act="cur" data-v="${c}">${c === 'LAK' ? '₭' : '฿'}</button>`).join('')}</div>
          <div class="seg sm">${[['lo', 'ລາວ'], ['th', 'ไทย']].map(([l, n]) => `<button class="${S.lang === l ? 'on' : ''}" data-act="lang" data-v="${l}">${n}</button>`).join('')}</div>
        </div>
      </header>
      <main id="main"></main>
      <div class="scrim" data-act="closeMenu"></div>
      <nav id="drawer" class="drawer">
        <div class="drawer-head"><b>${esc(S.me.display_name || S.me.username)}</b><small>${t('role_' + S.me.role)}</small></div>
        ${PAGES.filter(p => !p[2] || isOwner()).map(([k, ic]) => `<button class="nav ${S.page === k ? 'on' : ''}" data-act="go" data-page="${k}"><i class="ti ${ic}"></i>${t(k)}${k === 'stock' && low ? `<span class="badge red">${low}</span>` : ''}</button>`).join('')}
        <button class="nav" data-act="logout"><i class="ti ti-logout"></i>${t('logout')}</button>
      </nav>`;
    renderMain();
  }
  function renderMain() {
    const def = PAGES.find(p => p[0] === S.page);
    if (!def || (def[2] && !isOwner())) S.page = 'pos';
    const fn = VIEWS[S.page];
    $('#main').className = 'page-' + S.page;
    fn();
  }
  function go(page) {
    stopCamera();
    S.page = page; S.sheet = false;
    document.body.classList.remove('menu-open');
    render();
    window.scrollTo(0, 0);
    // เลื่อนจางเข้าเฉพาะตอนเปลี่ยนหน้า (ไม่เล่นซ้ำตอนพิมพ์ค้นหาแล้วหน้าวาดใหม่)
    const m = $('#main');
    m.classList.remove('enter'); void m.offsetWidth; m.classList.add('enter');
    clearTimeout(go.t); go.t = setTimeout(() => m.classList.remove('enter'), 700);
  }
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ประกายแตกออกจากจุดที่แตะ (แรงบันดาลใจจาก React Bits Click Spark)
  function spark(x, y) {
    if (reduceMotion() || x == null || (x === 0 && y === 0)) return;
    const box = document.createElement('div');
    box.className = 'spark'; box.style.left = x + 'px'; box.style.top = y + 'px';
    for (let i = 0; i < 8; i++) { const s = document.createElement('i'); s.style.setProperty('--a', (i * 45) + 'deg'); box.append(s); }
    document.body.append(box);
    setTimeout(() => box.remove(), 500);
  }

  function renderLogin() {
    $('#app').innerHTML = `
      <div class="login-wrap">
        <div class="aurora" aria-hidden="true"><i></i><i></i><i></i></div>
        <form class="login card" data-form="login">
          ${C.logo ? `<img class="login-logo" src="${esc(C.logo)}" alt="">` : '<div class="login-ic"><i class="ti ti-lock"></i></div>'}
          <h1 class="shiny">${esc(C.shopName)}</h1>
          <div class="seg sm center">${[['lo', 'ລາວ'], ['th', 'ไทย']].map(([l, n]) => `<button type="button" class="${S.lang === l ? 'on' : ''}" data-act="lang" data-v="${l}">${n}</button>`).join('')}</div>
          <label class="field"><span>${t('username')}</span><input name="u" autocomplete="username" autocapitalize="none" required></label>
          <label class="field"><span>${t('password')}</span><input name="p" type="password" autocomplete="current-password" required></label>
          <button class="btn-pay" type="submit">${t('login')}</button>
          ${db.mode === 'demo' ? `<p class="hint">${t('demoHint')}</p>` : ''}
        </form>
      </div>`;
    $('input[name=u]').focus();
  }

  // ------------------------------------------------------------ POS
  function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.products.filter(p => p.active !== false && (S.cat === 'all' || p.category === S.cat) && (!q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)));
  }
  const cartQty = id => (S.cart.find(l => l.id === id) || { qty: 0 }).qty;
  const cartTotal = () => sum(S.cart, l => { const p = prodById(l.id); return p ? p.price * l.qty : 0; });
  const cartCount = () => sum(S.cart, l => l.qty);

  function viewPos() {
    $('#main').innerHTML = `
      <div class="pos">
        <section class="pos-left">
          ${S.shift ? '' : `<div class="banner warn"><span>${t('needShift')}</span><button class="btn sm" data-act="openShiftModal">${t('openShift')}</button></div>`}
          <div class="searchbar">
            <i class="ti ti-barcode"></i>
            <input id="q" placeholder="${t('search')}" autocomplete="off" value="${esc(S.q)}" enterkeyhint="search">
            <button class="icon-btn" data-act="camera" aria-label="${t('scanCam')}"><i class="ti ti-camera"></i></button>
          </div>
          <div id="cats" class="chips"></div>
          <div id="grid" class="grid"></div>
        </section>
        <aside id="cartPanel" class="cart-panel"></aside>
      </div>
      <div id="cartBar"></div>`;
    drawPos();
    if (matchMedia('(min-width: 821px)').matches) $('#q').focus();
  }
  function drawPos() {
    if (S.page !== 'pos' || !$('#grid')) return;
    const cats = [...new Set(S.products.filter(p => p.active !== false).map(p => p.category).filter(Boolean))];
    $('#cats').innerHTML = ['all', ...cats].map(c => {
      const on = S.cat === c;
      const [bg, fg] = c === 'all' ? ['', ''] : catColor(c);
      return `<button class="chip ${on ? 'on' : ''}" data-act="cat" data-v="${esc(c)}" ${!on && bg ? `style="background:${bg};color:${fg};border-color:transparent"` : ''}>${c === 'all' ? t('all') : esc(c)}</button>`;
    }).join('');
    const list = filtered();
    const shown = list.slice(0, 60);
    $('#grid').innerHTML = shown.map(p => {
      const left = p.stock - cartQty(p.id);
      const n = cartQty(p.id);
      return `<button class="pcard ${left <= 0 ? 'out' : ''}" data-act="add" data-id="${p.id}">
        ${n ? `<span class="qty-badge ${S.bumpId === p.id ? 'bump' : ''}">${n}</span>` : ''}
        ${thumb(p, 'pimg')}
        <span class="pname">${esc(p.name)}</span>
        <span class="pprice">${money(p.price)}</span>
        <span class="pstock ${left <= p.min_stock ? 'low' : ''}">${left <= 0 ? t('out') : t('left') + ' ' + left}</span>
      </button>`;
    }).join('') + (list.length > shown.length ? `<div class="more">${t('moreResults', { n: list.length })}</div>` : '') + (!list.length ? `<div class="more">${t('noProducts')}</div>` : '');
    drawCart();
  }
  function addToCart(p, n) {
    n = n || 1;
    if (S.pay && S.pay.step === 'done') S.pay = null;
    if (S.pay && S.pay.step === 'pay' && !S.pay.busy) S.pay = null;
    if (S.pay && S.pay.busy) return;
    if (cartQty(p.id) + n > p.stock) { toast(t('out_of_stock', { d: p.name }), 'err'); beep(false); return; }
    const l = S.cart.find(x => x.id === p.id);
    if (l) l.qty += n; else S.cart.push({ id: p.id, qty: n });
    beep(true);
    drawPos();
  }
  function drawCart() {
    const panel = $('#cartPanel'); if (!panel) return;
    const total = cartTotal();
    panel.classList.toggle('sheet-open', S.sheet);
    const close = `<button class="icon-btn sheet-close" data-act="sheet" data-v="0" aria-label="${t('close')}"><i class="ti ti-chevron-down"></i></button>`;
    if (S.pay && S.pay.step === 'done') {
      const s = S.pay.sale;
      panel.innerHTML = `${close}<div class="done">
        <div class="done-ic"><i class="ti ti-check"></i></div>
        <h3>${t('saleDone')}</h3>
        <div class="muted">${t('bill')} #${shortId(s.id)} · ${lak(s.total)}</div>
        ${s.pay_method === 'cash' ? `<div class="muted mt">${t('change')}</div><div class="change-val big" id="chgDone">${lak(s.change_lak)}</div>` : `<div class="tag mt">${t(s.pay_method)}</div>`}
        <div class="stack mt">
          <button class="btn-pay" data-act="nextSale">${t('nextSale')}</button>
          <button class="btn" data-act="printReceipt"><i class="ti ti-printer"></i> ${t('print')}</button>
        </div></div>`;
      if (s.pay_method === 'cash') countUp($('#chgDone'), s.change_lak, lak);
    } else if (S.pay && S.pay.step === 'pay') {
      panel.innerHTML = close + payHtml(total);
      updChange(false);
      const a = $('#payAmt'); if (a && matchMedia('(min-width: 821px)').matches) a.focus();
    } else {
      panel.innerHTML = `${close}
        <div class="cart-head"><b>${t('cart')}</b>${S.cart.length ? `<button class="link" data-act="clearCart">${t('clear')}</button>` : ''}</div>
        <div class="cart-lines">${S.cart.length ? S.cart.map(l => {
          const p = prodById(l.id); if (!p) return '';
          return `<div class="cline">${thumb(p, 'cimg')}<div class="cname">${esc(p.name)}<small>${money(p.price)}</small></div>
            <div class="qtyc"><button data-act="qty" data-id="${p.id}" data-v="-1" aria-label="-">−</button><span>${l.qty}</span><button data-act="qty" data-id="${p.id}" data-v="1" aria-label="+">+</button></div>
            <b class="cline-total">${money(p.price * l.qty)}</b></div>`;
        }).join('') : `<div class="empty"><i class="ti ti-shopping-cart"></i>${t('cartEmpty')}</div>`}</div>
        <div class="cart-foot">
          <div class="total-row"><span>${t('total')} · ${cartCount()} ${t('pcs')}</span><b>${money(total)}</b></div>
          ${S.cur === 'THB' && rate() ? `<div class="sub-total">${lak(total)}</div>` : ''}
          <button class="btn-pay big" data-act="checkout">${t('checkout')}</button>
        </div>`;
    }
    const bar = $('#cartBar');
    if (bar) bar.innerHTML = S.cart.length && !S.sheet ? `<button class="cart-bar" data-act="sheet" data-v="1"><span><i class="ti ti-shopping-cart"></i> ${cartCount()} ${t('pcs')}</span><b>${t('checkout')} ${money(total)} →</b></button>` : '';
  }
  function quickAmounts(total, cur) {
    if (cur === 'THB') {
      const r = rate(), b = Math.ceil(total / r);
      return [...new Set([b, Math.ceil(b / 20) * 20, Math.ceil(b / 100) * 100, Math.ceil(b / 500) * 500, Math.ceil(b / 1000) * 1000])].slice(0, 5);
    }
    return [...new Set([total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, Math.ceil(total / 100000) * 100000])].slice(0, 5);
  }
  function payHtml(total) {
    const P = S.pay, r = rate();
    let body = '';
    if (P.method === 'cash') {
      const q = quickAmounts(total, P.currency);
      body = `
        ${r > 0 ? `<div class="row gap"><span class="muted">${t('paidIn')}</span><div class="seg">${['LAK', 'THB'].map(c => `<button class="${P.currency === c ? 'on' : ''}" data-act="payCur" data-v="${c}">${c === 'LAK' ? '₭ ' + t('lakName') : '฿ ' + t('thbName')}</button>`).join('')}</div></div>` : ''}
        <div class="quick">${q.map((v, i) => `<button class="qbtn" data-act="payQuick" data-v="${v}">${i === 0 ? t('exact') : fmtNum(v) + (P.currency === 'THB' ? ' ฿' : '')}</button>`).join('')}</div>
        <label class="field"><span>${t('received')} (${P.currency === 'THB' ? t('thbName') : t('lakName')})</span><input id="payAmt" data-money inputmode="numeric" autocomplete="off" value="${esc(money0(P.amount))}" placeholder="0"></label>
        <div class="change-box"><div class="muted">${t('change')}</div><div id="chg" class="change-val">-</div><div id="chg2" class="muted small"></div></div>`;
    } else if (P.method === 'qr') {
      body = `<div class="qr-box">${C.qrImage ? `<img src="${esc(C.qrImage)}" alt="QR">` : `<div class="muted">${t('noQr')}</div>`}<p class="small">${t('qrHint')}</p></div>`;
    } else {
      const q = (P.custQ || '').toLowerCase();
      const list = S.customers.filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)).slice(0, 8);
      body = `<label class="field"><span>${t('chooseCustomer')}</span><input id="custQ" value="${esc(P.custQ || '')}" placeholder="${t('search2')}" autocomplete="off"></label>
        <div class="cust-list">${list.map(c => `<button class="cust ${P.customer_id === c.id ? 'on' : ''}" data-act="pickCust" data-id="${c.id}"><span>${esc(c.name)}<small>${esc(c.phone || '')}</small></span><small>${t('balance')} ${lak(c.balance)}</small></button>`).join('')}
        ${q && !list.some(c => c.name.toLowerCase() === q) ? `<button class="cust new" data-act="newCustInline"><i class="ti ti-plus"></i> ${t('newCustomer')}: ${esc(P.custQ)}</button>` : ''}</div>`;
    }
    return `<div class="pay">
      <div class="cart-head"><button class="link" data-act="payBack">← ${t('back')}</button><span class="muted">${cartCount()} ${t('pcs')}</span></div>
      <div class="due"><span class="muted">${t('due')}</span><b>${lak(total)}</b>${r > 0 ? `<small>≈ ${thb(total / r)}</small>` : ''}</div>
      <div class="seg full">${['cash', 'qr', 'credit'].map(m => `<button class="${P.method === m ? 'on' : ''}" data-act="payMethod" data-v="${m}">${t(m)}</button>`).join('')}</div>
      <div class="pay-body">${body}</div>
      <button class="btn-pay big" data-act="confirmSale" ${P.busy ? 'aria-busy="true"' : ''}>${P.busy ? t('saving') : t('confirm')}</button>
    </div>`;
  }
  function updChange(animate) {
    const P = S.pay; const el = $('#chg'); if (!P || !el) return;
    const total = cartTotal(), r = rate();
    const paid = num(P.amount);
    const paidLak = P.currency === 'THB' ? paid * r : paid;
    const el2 = $('#chg2');
    if (!P.amount) { el.textContent = '-'; el.className = 'change-val'; el2.textContent = ''; return; }
    const diff = paidLak - total;
    if (diff < 0) { el.textContent = t('notEnough'); el.className = 'change-val neg'; el2.textContent = '− ' + lak(-diff); return; }
    el.className = 'change-val';
    if (animate) countUp(el, diff, lak); else el.textContent = lak(diff);
    el2.textContent = r > 0 && diff > 0 ? `${t('approx')} ${thb(diff / r)}` : '';
  }
  // ตัวเลขนับขึ้น (แรงบันดาลใจจาก React Bits Count Up)
  function countUp(el, to, fmt) {
    if (!el) return;
    const st = performance.now(), dur = 450;
    (function step(n) { const k = Math.min(1, (n - st) / dur); el.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); })(st);
    // ถ้าแท็บไม่ได้แสดงอยู่ requestAnimationFrame จะหยุด → ตั้งค่าสุดท้ายให้แน่นอน
    setTimeout(() => { el.textContent = fmt(to); }, dur + 80);
  }
  async function confirmSale(btn) {
    const P = S.pay, total = cartTotal();
    if (!S.shift) return openShiftModal();
    if (P.method === 'cash') {
      const paid = num(P.amount) || 0;
      const paidLak = P.currency === 'THB' ? paid * rate() : paid;
      if (!P.amount) { P.amount = String(P.currency === 'THB' ? Math.ceil(total / rate()) : total); }
      else if (paidLak < total) { toast(t('notEnough'), 'err'); beep(false); return; }
    }
    if (P.method === 'credit' && !P.customer_id) { toast(t('pickCustomer'), 'err'); return; }
    P.busy = true; drawCart();
    try {
      const lines = S.cart.map(l => { const p = prodById(l.id); return { product_id: l.id, qty: l.qty, name: p.name, price: p.price }; });
      const sale = await db.createSale({
        client_id: P.client_id, items: lines.map(l => ({ product_id: l.product_id, qty: l.qty })),
        pay_method: P.method, paid_currency: P.method === 'cash' ? P.currency : 'LAK',
        paid_amount: P.method === 'cash' ? num(P.amount) : 0, customer_id: P.method === 'credit' ? P.customer_id : null,
      });
      for (const l of lines) { const p = prodById(l.product_id); if (p) p.stock -= l.qty; }
      S.pay = { step: 'done', sale: { ...sale, total: Number(sale.total), change_lak: Number(sale.change_lak) }, lines };
      S.cart = [];
      beep(true);
      drawPos();
      refreshProducts().catch(() => {});
    } catch (e) {
      P.busy = false; drawCart();
      toast(errMsg(e), 'err'); beep(false);
      if (e.code === 'out_of_stock') refreshProducts().then(drawPos).catch(() => {});
    } finally { void btn; }
  }

  function receiptHtml(sale, lines) {
    const shop = S.settings.shop_name || C.shopName;
    return `<div class="receipt">
      <h2>${esc(shop)}</h2>
      <div>${dmy(sale.created_at)} ${hhmm(sale.created_at)} · ${t('bill')} #${shortId(sale.id)}</div>
      <div>${t('cashier')}: ${esc(S.me.display_name || S.me.username)}</div>
      <hr>
      ${lines.map(l => `<div class="rl"><span>${esc(l.name)} ×${l.qty}</span><span>${fmtNum(l.price * l.qty)}</span></div>`).join('')}
      <hr>
      <div class="rl b"><span>${t('total')}</span><span>${lak(sale.total)}</span></div>
      <div class="rl"><span>${t(sale.pay_method)}</span><span>${sale.pay_method === 'cash' ? (sale.paid_currency === 'THB' ? thb(sale.paid_amount) : lak(sale.paid_amount)) : ''}</span></div>
      ${sale.pay_method === 'cash' ? `<div class="rl"><span>${t('change')}</span><span>${lak(sale.change_lak)}</span></div>` : ''}
      <hr><div class="c">${t('thanks')}</div></div>`;
  }
  function printHtml(html, mode) {
    $('#print-area').innerHTML = html;
    document.body.classList.add('printing', mode);
    setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('printing', mode), 500); }, 60);
  }

  // ------------------------------------------------------------ camera
  let scanner = null;
  async function openCamera(onCode) {
    modal(`<div class="modal-head"><b>${t('scanCam')}</b><button class="icon-btn" data-act="closeModal" aria-label="${t('close')}"><i class="ti ti-x"></i></button></div><div id="reader" class="reader"></div><p class="hint" id="lastScan"></p>`);
    try {
      await loadScript(LIB.qr);
      const H = window.Html5Qrcode, F = window.Html5QrcodeSupportedFormats;
      scanner = new H('reader', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE], verbose: false });
      let last = '', lastAt = 0;
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, code => {
        const n = Date.now();
        if (code === last && n - lastAt < 1500) return;
        last = code; lastAt = n;
        const el = $('#lastScan'); if (el) el.textContent = code;
        onCode(code);
      }, () => {});
    } catch (e) {
      console.warn(e); toast(t('camErr'), 'err'); closeModal();
    }
  }
  function stopCamera() {
    if (!scanner) return;
    const s = scanner; scanner = null;
    // stop() ใช้ได้เฉพาะตอนกล้องกำลังสแกน · ถ้ายังเปิดกล้องไม่สำเร็จ ให้ล้างอย่างเดียว
    try {
      if (s.isScanning) s.stop().then(() => s.clear()).catch(() => {});
      else s.clear();
    } catch (e) { /* camera never started */ }
  }
  function findByCode(code) { return S.products.find(p => p.barcode && p.barcode === code.trim()); }

  // ------------------------------------------------------------ modal
  function modal(html, cls) { $('#modal').innerHTML = `<div class="scrim show" data-act="closeModal"></div><div class="modal ${cls || ''}" role="dialog">${html}</div>`; }
  function closeModal() { stopCamera(); $('#modal').innerHTML = ''; }

  function openShiftModal() {
    modal(`<form data-form="openShift"><div class="modal-head"><b>${t('openShift')}</b></div>
      <label class="field"><span>${t('openingCash')}</span><input name="opening" data-money inputmode="numeric" value="0" required></label>
      <div class="row end gap"><button type="button" class="btn" data-act="closeModal">${t('cancel')}</button><button class="btn-pay" type="submit">${t('openShift')}</button></div></form>`);
    $('#modal input').select();
  }

  // ------------------------------------------------------------ product picker (รับเข้า / COD)
  function pickerHtml(target) {
    return `<div class="picker"><div class="searchbar"><i class="ti ti-search"></i>
      <input data-picker="${target}" placeholder="${t('search')}" autocomplete="off" enterkeyhint="search">
      <button class="icon-btn" data-act="pickCam" data-target="${target}" aria-label="${t('scanCam')}"><i class="ti ti-camera"></i></button></div>
      <div class="pick-res" id="pk-${target}"></div></div>`;
  }
  function pickerResults(target, q) {
    const box = $('#pk-' + target); if (!box) return;
    q = q.trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    const list = S.products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)).slice(0, 8);
    box.innerHTML = list.map(p => `<button class="pick" data-act="pick" data-target="${target}" data-id="${p.id}">${thumb(p, 'cimg')}<span>${esc(p.name)}<small>${t('left')} ${p.stock} · ${money(p.price)}</small></span></button>`).join('') || `<div class="muted small pad">${t('noProducts')}</div>`;
  }
  function pickAdd(target, p) {
    if (target === 'recv') {
      const r = S.recv.rows.find(x => x.product_id === p.id);
      if (r) r.qty = String(num(r.qty) + 1);
      else S.recv.rows.push({ product_id: p.id, qty: '1', by: p.pack_size > 1 ? 'pack' : 'unit', cost: '', expiry: '' });
      viewReceive();
    } else if (target === 'cod') {
      const it = S.cod.items.find(x => x.product_id === p.id);
      if (it) it.qty += 1; else S.cod.items.push({ product_id: p.id, qty: 1 });
      drawCodForm();
    }
    beep(true);
  }

  // ------------------------------------------------------------ views
  const VIEWS = {
    pos: viewPos,
    receive: viewReceive,
    stock: viewStock,
    cod: viewCod,
    debts: viewDebts,
    history: viewHistory,
    shift: viewShift,
    products: viewProducts,
    labels: viewLabels,
    expenses: viewExpenses,
    reports: viewReports,
    settings: viewSettings,
  };
  const pageHead = (title, extra) => `<div class="page-head"><h2>${title}</h2>${extra || ''}</div>`;
  const loading = () => { $('#main').innerHTML = `<div class="loading"><i class="ti ti-loader-2 spin"></i></div>`; };

  function viewReceive() {
    const rows = S.recv.rows;
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('receiveTitle'))}
      ${pickerHtml('recv')}
      <div class="card mt">${rows.length ? rows.map((r, i) => {
        const p = prodById(r.product_id); if (!p) return '';
        const per = r.by === 'pack' ? t('packWord') : p.unit || t('pcs');
        const costNow = (S.costs[p.id] || 0) * (r.by === 'pack' ? p.pack_size : 1);
        return `<div class="rrow">
          <div class="rname">${thumb(p, 'cimg')}<span>${esc(p.name)}<small>${t('stockNow')}: ${p.stock} ${esc(p.unit)}</small></span>
            <button class="icon-btn" data-act="recvDel" data-i="${i}" aria-label="${t('remove')}"><i class="ti ti-trash"></i></button></div>
          <div class="rfields">
            <label class="field"><span>${t('qty')}</span><input data-recv="${i}" data-f="qty" inputmode="numeric" value="${esc(r.qty)}"></label>
            ${p.pack_size > 1 ? `<label class="field"><span>&nbsp;</span><select data-recv="${i}" data-f="by"><option value="pack" ${r.by === 'pack' ? 'selected' : ''}>${t('byPack')} (×${p.pack_size})</option><option value="unit" ${r.by === 'unit' ? 'selected' : ''}>${esc(p.unit || t('pcs'))}</option></select></label>` : ''}
            <label class="field"><span>${t('costPer')} ${esc(per)}</span><input data-recv="${i}" data-f="cost" data-money inputmode="numeric" value="${esc(r.cost)}" placeholder="${fmtNum(costNow)}"></label>
            <label class="field"><span>${t('expiry')}</span><input type="date" data-recv="${i}" data-f="expiry" value="${esc(r.expiry)}"></label>
          </div></div>`;
      }).join('') : `<div class="empty"><i class="ti ti-package-import"></i>${t('receiveEmpty')}</div>`}</div>
      ${rows.length ? `<div class="card mt">
        <p class="hint">${t('costPer')}: ${t('costBlank')}</p>
        <button class="btn-pay big mt" data-act="recvSave">${t('receiveSave')} · ${rows.length} ${t('items')}</button></div>` : ''}
    </div>`;
  }
  async function recvSave(btn) {
    const items = [];
    for (const r of S.recv.rows) {
      const p = prodById(r.product_id); const mult = r.by === 'pack' ? p.pack_size : 1;
      const qty = Math.round(num(r.qty) * mult);
      if (qty <= 0) continue;
      items.push({ product_id: p.id, qty, unit_cost: r.cost === '' ? null : num(r.cost) / mult, expiry_date: r.expiry || null });
    }
    if (!items.length) return toast(t('needItems'), 'err');
    await withBusy(btn, async () => {
      await db.receiveStock({ items, supplier: '', note: '' });
      S.recv = { rows: [], supplier: '', note: '' };
      await refreshProducts();
      // หน้าเว็บไม่รู้ว่าตั้ง Discord/WhatsApp ไว้หรือยัง จึงไม่บอกว่า "ส่งแจ้งเตือนแล้ว"
      toast(t('receivedOk', { n: items.length }), 'ok');
      viewReceive();
    });
  }

  async function viewStock() {
    loading();
    const days = num(S.settings.expiry_warn_days) || 30;
    let exp = [];
    try { await refreshProducts(); exp = await db.expiringSoon(days); } catch (e) { toast(errMsg(e), 'err'); }
    if (S.page !== 'stock') return;
    const today = ymd(new Date());
    const low = S.products.filter(p => p.active !== false && p.stock <= p.min_stock).sort((a, b) => a.stock - b.stock);
    const act = S.products.filter(p => p.active !== false);
    const value = sum(act, p => Math.max(0, p.stock) * (S.costs[p.id] || 0));
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('stock'), isOwner() ? `<div class="kpi sm"><span>${t('stockValue')}</span><b>${lak(value)}</b></div>` : '')}
      <div class="grid2">
        <div class="card"><h3><i class="ti ti-alert-triangle warn-ic"></i> ${t('lowStock')} (${low.length})</h3>
          ${low.length ? low.map(p => `<div class="lrow">${thumb(p, 'cimg')}<span class="grow">${esc(p.name)}<small>${t('minStock')} ${p.min_stock}</small></span><b class="${p.stock <= 0 ? 'neg' : 'warn-t'}">${p.stock}</b><button class="btn sm" data-act="recvFor" data-id="${p.id}">${t('receiveThis')}</button></div>`).join('') : `<p class="muted">${t('noneLow')}</p>`}
        </div>
        <div class="card"><h3><i class="ti ti-calendar-exclamation warn-ic"></i> ${t('expiring')} (${exp.length})</h3>
          ${exp.length ? exp.map(x => { const dd = Math.round((new Date(x.expiry_date) - new Date(today)) / 864e5); return `<div class="lrow"><span class="grow">${esc(x.name)}<small>${dmy(x.expiry_date)} · ${x.qty_left} ${esc(x.unit || '')}</small></span><span class="tag ${dd < 0 ? 'red' : dd <= 7 ? 'amber' : ''}">${dd < 0 ? t('expired') : t('daysLeft', { n: dd })}</span></div>`; }).join('') : `<p class="muted">${t('noneExp')}</p>`}
          <p class="hint">${t('expNote')}</p>
        </div>
      </div>
      <div class="card mt"><h3>${t('allStock')}</h3>
        <div class="table">${S.products.map(p => `<div class="trow ${p.active === false ? 'dim' : ''}">${thumb(p, 'cimg')}<span class="grow">${esc(p.name)}${p.active === false ? ` <span class="tag">${t('hidden')}</span>` : ''}<small>${esc(p.category)}</small></span><b class="${p.active !== false && p.stock <= p.min_stock ? 'warn-t' : ''}">${p.stock} ${esc(p.unit)}</b>${isOwner() ? `<span class="muted w100 r">${lak(Math.max(0, p.stock) * (S.costs[p.id] || 0))}</span>` : ''}
          <span class="row-acts"><button class="icon-btn" data-act="prodEdit" data-id="${p.id}" aria-label="${t('edit')}"><i class="ti ti-pencil"></i></button><button class="icon-btn danger" data-act="prodDel" data-id="${p.id}" aria-label="${t('delete')}"><i class="ti ti-trash"></i></button></span></div>`).join('') || `<p class="muted">${t('noProducts')}</p>`}</div>
      </div></div>`;
  }

  // ---- COD
  async function viewCod() {
    loading();
    let orders = [];
    try { orders = await db.listCod(); } catch (e) { toast(errMsg(e), 'err'); }
    if (S.page !== 'cod') return;
    S.codOrders = orders;
    drawCod();
  }
  const NEXT = { pending: 'shipped', shipped: 'delivered', delivered: 'paid' };
  function drawCod() {
    const orders = S.codOrders || [];
    const F = S.codFilter;
    const show = orders.filter(o => F === 'all' || (F === 'open' ? ['pending', 'shipped', 'delivered'].includes(o.status) : o.status === F));
    const count = s => orders.filter(o => o.status === s).length;
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('cod'), `<button class="btn-pay" data-act="codNew"><i class="ti ti-plus"></i> ${t('newOrder')}</button>`)}
      <div id="codForm"></div>
      <div class="chips">${[['open', t('open')], ['pending', t('st_pending')], ['shipped', t('st_shipped')], ['delivered', t('st_delivered')], ['paid', t('st_paid')], ['returned', t('st_returned')], ['all', t('all')]].map(([k, n]) => `<button class="chip ${F === k ? 'on' : ''}" data-act="codFilter" data-v="${k}">${n}${k !== 'open' && k !== 'all' && count(k) ? ` · ${count(k)}` : ''}</button>`).join('')}</div>
      <div class="cod-list">${show.length ? show.map(o => `<div class="card cod">
        <div class="row between"><b>${esc(o.customer_name)}</b><span class="tag st-${o.status}">${t('st_' + o.status)}</span></div>
        <div class="small muted">${dmy(o.created_at)} ${hhmm(o.created_at)}${o.phone ? ' · <i class="ti ti-phone"></i> ' + esc(o.phone) : ''}</div>
        <div class="small mt">${(o.items || []).map(i => `${esc(i.name)} ×${i.qty}`).join(', ')}</div>
        ${o.courier || o.tracking ? `<div class="row gap small mt">${courierBadge(o.courier)}${o.tracking ? `<span class="muted">${t('tracking')}: ${esc(o.tracking)}</span>` : ''}</div>` : ''}
        <div class="row between mt"><span>${t('codTotal')} <b>${lak(o.total)}</b></span>
          <span class="row gap"><button class="btn sm" data-act="codEdit" data-id="${o.id}"><i class="ti ti-pencil"></i> ${t('edit')}</button>${NEXT[o.status] ? `${o.status !== 'paid' ? `<button class="btn sm" data-act="codStatus" data-id="${o.id}" data-v="returned">${t('st_returned')}</button>` : ''}<button class="btn-pay sm" data-act="codStatus" data-id="${o.id}" data-v="${NEXT[o.status]}">${t('toStatus', { s: t('st_' + NEXT[o.status]) })}</button>` : ''}</span></div>
      </div>`).join('') : `<div class="empty card"><i class="ti ti-truck-delivery"></i>${t('noOrders')}</div>`}</div></div>`;
    if (S.cod) drawCodForm();
  }
  function drawCodForm() {
    const box = $('#codForm'); if (!box) return;
    if (!S.cod) { box.innerHTML = ''; return; }
    const f = S.cod;
    // แก้ออเดอร์เดิม: บรรทัดเดิมใช้ราคาตอนสั่ง (i.price) · บรรทัดใหม่ใช้ราคาปัจจุบัน
    const priceOf = i => { const p = prodById(i.product_id); return i.price != null ? i.price : p ? p.price : 0; };
    const sub = sum(f.items, i => priceOf(i) * i.qty);
    box.innerHTML = `<div class="card mb ${f.id ? 'editing' : ''}">
      ${f.id ? `<div class="row between mb"><b><i class="ti ti-pencil"></i> ${t('editOrder')}</b><span class="tag st-${f.status}">${t('st_' + f.status)}</span></div>` : ''}
      <div class="grid2">
        <label class="field"><span>${t('customer')} *</span><input data-cod="customer_name" value="${esc(f.customer_name)}"></label>
        <label class="field"><span>${t('phone')}</span><input data-cod="phone" inputmode="tel" value="${esc(f.phone)}"></label>
      </div>
      <div class="field"><span>${t('pickCourier')}</span>${courierTiles(f.courier, 'codCourier')}</div>
      ${f.id ? `<label class="field"><span>${t('tracking')}</span><input data-cod="tracking" value="${esc(f.tracking)}"></label>` : ''}
      <h3 class="mt">${t('addItems')}</h3>
      ${f.locked ? `<p class="hint">${t('itemsLocked')}</p>` : pickerHtml('cod')}
      <div class="mt">${f.items.map(i => { const p = prodById(i.product_id); const name = p ? p.name : i.name; const price = priceOf(i); return `<div class="cline">${p ? thumb(p, 'cimg') : ''}<div class="cname">${esc(name)}<small>${lak(price)}</small></div>
        ${f.locked ? `<span class="qtyc"><span>×${i.qty}</span></span>` : `<div class="qtyc"><button data-act="codQty" data-id="${i.product_id}" data-v="-1">−</button><span>${i.qty}</span><button data-act="codQty" data-id="${i.product_id}" data-v="1">+</button></div>`}<b>${lak(price * i.qty)}</b></div>`; }).join('')}</div>
      <label class="field mt"><span>${t('note')}</span><input data-cod="note" value="${esc(f.note)}"></label>
      <div class="row between mt"><span>${t('codTotal')} <b class="big-t">${lak(sub)}</b></span>
        <span class="row gap"><button class="btn" data-act="codCancel">${t('cancel')}</button><button class="btn-pay" data-act="codSave">${t('save')}</button></span></div>
    </div>`;
  }
  async function codSave(btn) {
    const f = S.cod;
    if (!f.customer_name.trim()) return toast(t('needCustomer'), 'err');
    if (!f.items.length) return toast(t('needItems'), 'err');
    await withBusy(btn, async () => {
      const items = f.items.map(i => ({ product_id: i.product_id, qty: i.qty }));
      if (f.id) {
        // ออเดอร์ที่ปิดแล้ว (ได้เงิน/ตีกลับ) แก้ได้แค่ข้อมูลลูกค้าและขนส่ง → ไม่ส่งรายการสินค้า
        await db.updateCod({ id: f.id, customer_name: f.customer_name.trim(), phone: f.phone, courier: f.courier, tracking: f.tracking, note: f.note, items: f.locked ? null : items });
      } else {
        await db.createCod({ client_id: f.client_id, customer_name: f.customer_name.trim(), phone: f.phone, courier: f.courier, note: f.note, items });
      }
      const msg = f.id ? t('orderUpdated') : t('orderSaved');
      S.cod = null;
      await refreshProducts();
      toast(msg, 'ok');
      viewCod();
    });
  }
  function codStatus(id, status) {
    if (status === 'returned') {
      modal(`<div class="modal-head"><b>${t('st_returned')}</b></div><p>${t('confirmReturn')}</p>
        <div class="row end gap"><button class="btn" data-act="closeModal">${t('cancel')}</button><button class="btn-danger" data-act="codStatusGo" data-id="${id}" data-v="returned">${t('st_returned')}</button></div>`);
      return;
    }
    if (status === 'shipped') {
      const o = S.codOrders.find(x => x.id === id) || {};
      modal(`<form data-form="codShip" data-id="${id}"><div class="modal-head"><b>${t('st_shipped')}</b></div>
        <input type="hidden" name="courier" value="${esc(o.courier || '')}">
        <div class="field"><span>${t('pickCourier')}</span>${courierTiles(o.courier || '', 'shipCourier')}</div>
        <label class="field"><span>${t('tracking')}</span><input name="tracking" value="${esc(o.tracking || '')}"></label>
        <div class="row end gap"><button type="button" class="btn" data-act="closeModal">${t('cancel')}</button><button class="btn-pay" type="submit">${t('save')}</button></div></form>`);
      return;
    }
    codStatusGo(null, id, status);
  }
  async function codStatusGo(btn, id, status, extra) {
    await withBusy(btn, async () => {
      await db.setCodStatus(id, status, extra);
      closeModal();
      if (status === 'returned') await refreshProducts();
      viewCod();
    });
  }

  // ---- debts
  async function viewDebts() {
    loading();
    try { S.customers = await db.listCustomers(); } catch (e) { toast(errMsg(e), 'err'); }
    if (S.page !== 'debts') return;
    drawDebts('');
  }
  function drawDebts(q) {
    const list = S.customers.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || '').includes(q)).sort((a, b) => b.balance - a.balance);
    const totalDebt = sum(S.customers, c => Math.max(0, c.balance));
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('debts'), `<button class="btn-pay" data-act="custNew"><i class="ti ti-plus"></i> ${t('addCustomer')}</button>`)}
      <div class="kpis"><div class="kpi"><span>${t('totalDebt')}</span><b class="${totalDebt ? 'warn-t' : ''}">${lak(totalDebt)}</b></div></div>
      <div class="searchbar mt"><i class="ti ti-search"></i><input id="debtQ" placeholder="${t('search2')}" value="${esc(q)}" autocomplete="off"></div>
      <div class="card mt">${list.length ? list.map(c => `<button class="lrow btnrow" data-act="custOpen" data-id="${c.id}"><span class="grow">${esc(c.name)}<small>${esc(c.phone || '')}</small></span><b class="${c.balance > 0 ? 'warn-t' : 'muted'}">${lak(c.balance)}</b><i class="ti ti-chevron-right muted"></i></button>`).join('') : `<p class="muted">${t('noDebt')}</p>`}</div></div>`;
  }
  async function custOpen(id) {
    const c = S.customers.find(x => x.id === id); if (!c) return;
    let entries = [];
    try { entries = await db.listDebtEntries(id); } catch (e) { toast(errMsg(e), 'err'); }
    modal(`<div class="modal-head"><b>${esc(c.name)}</b><button class="icon-btn" data-act="closeModal" aria-label="${t('close')}"><i class="ti ti-x"></i></button></div>
      <div class="due"><span class="muted">${t('balance')}</span><b>${lak(c.balance)}</b></div>
      <form data-form="debtPay" data-id="${id}" class="card flat">
        <div class="grid2"><label class="field"><span>${t('receivePay')} (${t('lakName')})</span><input name="amount" data-money inputmode="numeric" value="${c.balance > 0 ? fmtNum(c.balance) : ''}" required></label>
        <label class="field"><span>&nbsp;</span><select name="method"><option value="cash">${t('cash')}</option><option value="qr">${t('qr')}</option></select></label></div>
        <label class="field"><span>${t('note')}</span><input name="note"></label>
        <button class="btn-pay" type="submit">${t('receivePay')}</button>
      </form>
      <h3 class="mt">${t('history')}</h3>
      <div class="scroll-list">${entries.map(e => `<div class="lrow"><span class="grow">${dmy(e.created_at)} ${hhmm(e.created_at)}<small>${esc(e.note || '')}</small></span><b class="${e.kind === 'charge' ? 'warn-t' : 'pos-t'}">${e.kind === 'charge' ? '+' : '−'} ${lak(e.amount)}</b><span class="tag">${t(e.kind)}</span></div>`).join('') || `<p class="muted">-</p>`}</div>`);
  }

  // ---- history
  async function viewHistory() {
    S.histDate = S.histDate || ymd(new Date());
    loading();
    let sales = [];
    try { const [a, b] = dayRange(S.histDate); sales = await db.listSales(a, b); } catch (e) { toast(errMsg(e), 'err'); }
    if (S.page !== 'history') return;
    S.histSales = sales;
    const done = sales.filter(s => s.status === 'done');
    const by = m => sum(done.filter(s => s.pay_method === m), s => Number(s.total));
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('history'), `<input type="date" id="histDate" value="${S.histDate}" max="${ymd(new Date())}">`)}
      <div class="kpis">
        <div class="kpi"><span>${t('total')} · ${done.length} ${t('bills')}</span><b>${lak(sum(done, s => Number(s.total)))}</b></div>
        <div class="kpi"><span>${t('cash')}</span><b>${lak(by('cash'))}</b></div>
        <div class="kpi"><span>${t('qr')}</span><b>${lak(by('qr'))}</b></div>
        <div class="kpi"><span>${t('credit')}</span><b>${lak(by('credit'))}</b></div>
      </div>
      <div class="card mt">${sales.length ? sales.map(s => `<div class="lrow ${s.status === 'void' ? 'voided' : ''}">
        <span class="w60">${hhmm(s.created_at)}</span>
        <span class="grow">#${shortId(s.id)}<small>${esc(s.cashier || '')}${s.status === 'void' ? ' · ' + t('voided') + (s.void_reason ? ': ' + esc(s.void_reason) : '') : ''}</small></span>
        <span class="tag">${t(s.pay_method)}</span><b>${lak(s.total)}</b>
        ${isOwner() ? `<button class="icon-btn" data-act="saleOpen" data-id="${s.id}" aria-label="${t('viewItems')}"><i class="ti ti-dots"></i></button>` : ''}
      </div>`).join('') : `<p class="muted">-</p>`}</div></div>`;
  }
  async function saleOpen(id) {
    const s = S.histSales.find(x => x.id === id); if (!s) return;
    let items = [];
    try { items = await db.saleItemsOf(id); } catch (e) { toast(errMsg(e), 'err'); }
    S.viewSale = { sale: s, items };
    modal(`<div class="modal-head"><b>${t('bill')} #${shortId(s.id)}</b><button class="icon-btn" data-act="closeModal" aria-label="${t('close')}"><i class="ti ti-x"></i></button></div>
      <div class="small muted">${dmy(s.created_at)} ${hhmm(s.created_at)} · ${esc(s.cashier || '')} · ${t(s.pay_method)}</div>
      <div class="mt">${items.map(i => `<div class="lrow"><span class="grow">${esc(i.name)} ×${i.qty}<small>${t('costShort')}: ${lak(i.cost * i.qty)}</small></span><b>${lak(i.price * i.qty)}</b></div>`).join('')}</div>
      <div class="total-row mt"><span>${t('total')}</span><b>${lak(s.total)}</b></div>
      <div class="row end gap mt"><button class="btn" data-act="reprint"><i class="ti ti-printer"></i> ${t('reprint')}</button>
      ${s.status === 'done' ? `<button class="btn-danger" data-act="voidAsk" data-id="${s.id}">${t('voidBill')}</button>` : ''}</div>
      <div id="voidBox"></div>`);
  }

  // ---- shift
  async function viewShift() {
    loading();
    let past = [];
    try { S.shift = await db.currentShift(); if (isOwner()) past = await db.listShifts(); } catch (e) { toast(errMsg(e), 'err'); }
    if (S.page !== 'shift') return;
    const s = S.shift;
    $('#main').innerHTML = `<div class="wrap narrow">
      ${pageHead(t('shift'))}
      ${s ? `<div class="card">
        <div class="row between"><b>${t('openSince')} ${hhmm(s.opened_at)} · ${dmy(s.opened_at)}</b><span class="tag green">${t('open')}</span></div>
        <div class="small muted">${t('openedBy')}: ${esc(s.opened_by_name || '')} · ${t('openingCash')}: ${lak(s.opening_cash)}</div>
        <form data-form="closeShift" class="mt">
          <p class="hint">${t('blindCount')}</p>
          <div class="grid2">
            <label class="field"><span>${t('countedLak')}</span><input name="lak" data-money inputmode="numeric" required></label>
            <label class="field"><span>${t('countedThb')}</span><input name="thb" data-money inputmode="numeric" value="0"></label>
          </div>
          <label class="field"><span>${t('note')}</span><input name="note"></label>
          <button class="btn-pay big" type="submit">${t('closeShift')}</button>
        </form></div>` : `<form class="card" data-form="openShift">
          <label class="field"><span>${t('openingCash')}</span><input name="opening" data-money inputmode="numeric" value="0" required></label>
          <button class="btn-pay big" type="submit">${t('openShift')}</button></form>`}
      ${isOwner() && past.length ? `<div class="card mt"><h3>${t('pastShifts')}</h3>${past.map(x => `<div class="lrow"><span class="grow">${dmy(x.opened_at)} ${hhmm(x.opened_at)}–${hhmm(x.closed_at)}<small>${esc(x.opened_by_name || '')}</small></span>
        <span class="small muted r">${t('expected')} ${lak(x.expected_cash)}</span><b class="${Math.abs(x.diff) < 1 ? 'pos-t' : 'neg'}">${x.diff > 0 ? '+' : ''}${lak(x.diff)}</b></div>`).join('')}</div>` : ''}
    </div>`;
  }
  function shiftResult(r) {
    const d = Number(r.diff);
    const label = Math.abs(d) < 1 ? t('shiftOk') : d > 0 ? t('shiftOver') : t('shiftShort');
    modal(`<div class="modal-head"><b>${t('shiftClosed')}</b></div>
      <div class="lrow"><span class="grow">${t('openingCash')}</span><b>${lak(r.opening_cash)}</b></div>
      <div class="lrow"><span class="grow">${t('cashSales')}</span><b>${lak(r.cash_sales || 0)}</b></div>
      <div class="lrow"><span class="grow">${t('debtPaid')}</span><b>${lak(r.debt_paid || 0)}</b></div>
      <div class="lrow"><span class="grow">${t('expected')}</span><b>${lak(r.expected_cash)}</b></div>
      <div class="lrow"><span class="grow">${t('counted')}</span><b>${lak(Number(r.counted_lak) + Number(r.counted_thb) * Number(r.rate_thb || 0))}</b></div>
      <div class="due mt"><span class="muted">${t('diff')} · ${label}</span><b class="${Math.abs(d) < 1 ? 'pos-t' : 'neg'}">${d > 0 ? '+' : ''}${lak(d)}</b></div>
      <div class="row end"><button class="btn-pay" data-act="closeModal">OK</button></div>`);
  }

  // ---- products (owner)
  function viewProducts() {
    const q = (S.prodQ || '').toLowerCase();
    const list = S.products.filter(p => !q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q) || (p.category || '').toLowerCase().includes(q));
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('products') + ` <small class="muted">(${S.products.length})</small>`, `<button class="btn-pay" data-act="prodNew"><i class="ti ti-plus"></i> ${t('addProduct')}</button>`)}
      <div class="searchbar"><i class="ti ti-search"></i><input id="prodQ" placeholder="${t('search')}" value="${esc(S.prodQ || '')}" autocomplete="off"></div>
      <div class="card mt">${list.slice(0, 200).map(p => {
        const c = S.costs[p.id] || 0, pr = p.price - c;
        return `<button class="prow" data-act="prodEdit" data-id="${p.id}">${thumb(p, 'cimg')}
          <span class="grow">${esc(p.name)}${p.active === false ? ` <span class="tag">${t('hidden')}</span>` : ''}<small>${esc(p.category)} · ${p.barcode ? esc(p.barcode) : '—'}</small></span>
          <span class="pcol"><small>${t('price')}</small>${lak(p.price)}</span>
          <span class="pcol"><small>${t('costShort')}</small>${lak(c)}</span>
          <span class="pcol"><small>${t('profitPer')}</small><b class="${pr < 0 ? 'neg' : 'pos-t'}">${lak(pr)}</b>${p.price ? `<small>${Math.round(pr / p.price * 100)}%</small>` : ''}</span>
          <span class="pcol"><small>${t('stock')}</small><b class="${p.stock <= p.min_stock ? 'warn-t' : ''}">${p.stock}</b></span>
        </button>`;
      }).join('')}</div></div>`;
  }
  function prodForm(p) {
    p = p || { name: '', category: '', barcode: '', unit: '', pack_name: '', pack_size: 1, price: '', stock: 0, min_stock: 5, active: true, image_url: null };
    S.edit = { id: p.id || null, blob: null, image_url: p.image_url };
    const cats = [...new Set(S.products.map(x => x.category).filter(Boolean))];
    modal(`<form data-form="product"><div class="modal-head"><b>${p.id ? t('editProduct') : t('addProduct')}</b><button type="button" class="icon-btn" data-act="closeModal" aria-label="${t('close')}"><i class="ti ti-x"></i></button></div>
      <div class="photo-row"><div id="photoPrev" class="photo-prev">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : '<i class="ti ti-photo"></i>'}</div>
        <label class="btn"><i class="ti ti-camera"></i> ${t('choosePhoto')}<input type="file" accept="image/*" id="photoIn" hidden></label></div>
      <label class="field"><span>${t('name')} *</span><input name="name" value="${esc(p.name)}" required></label>
      <div class="grid2">
        <label class="field"><span>${t('category')}</span><input name="category" value="${esc(p.category)}" list="catList"></label>
        <label class="field"><span>${t('barcode')}</span><span class="row gap"><input name="barcode" id="bcIn" value="${esc(p.barcode || '')}" inputmode="numeric"><button type="button" class="btn sm" data-act="genBarcode">${t('genBarcode')}</button></span></label>
      </div>
      <datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <svg id="bcPrev" class="bc-prev"></svg>
      <div class="grid2">
        <label class="field"><span>${t('unit')}</span><input name="unit" value="${esc(p.unit)}"></label>
        <label class="field"><span>${t('cost')}</span><input name="cost" data-money inputmode="numeric" value="${p.id ? fmtNum(S.costs[p.id] || 0) : ''}"></label>
        <label class="field"><span>${t('packSize')}</span><input name="pack_size" inputmode="numeric" value="${esc(p.pack_size)}"><small class="muted">${t('packHint')}</small></label>
        <label class="field"><span>${t('price')} *</span><input name="price" data-money inputmode="numeric" value="${esc(money0(p.price))}" required></label>
        <label class="field"><span>${t('stockNow')}</span><input name="stock" inputmode="numeric" value="${esc(p.stock)}"><small class="muted">${t('stockAdjustHint')}</small></label>
        <label class="field"><span>${t('minStock')}</span><input name="min_stock" inputmode="numeric" value="${esc(p.min_stock)}"></label>
        <label class="check"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> ${t('showOnPos')}</label>
      </div>
      <div class="row end gap mt">${p.id ? `<button type="button" class="btn-danger" data-act="prodDel" data-id="${p.id}"><i class="ti ti-trash"></i> ${t('delete')}</button><span class="grow"></span><button type="button" class="btn" data-act="labelFor" data-id="${p.id}"><i class="ti ti-barcode"></i> ${t('printLabel')}</button>` : ''}
        <button class="btn-pay" type="submit">${t('save')}</button></div></form>`, 'wide');
    drawBarcodePreview();
  }
  async function drawBarcodePreview() {
    const v = ($('#bcIn') || {}).value || '', svg = $('#bcPrev');
    if (!svg) return;
    if (!v) { svg.innerHTML = ''; svg.removeAttribute('style'); return; }
    try { await loadScript(LIB.barcode); window.JsBarcode(svg, v, { format: /^\d{13}$/.test(v) ? 'EAN13' : 'CODE128', height: 40, fontSize: 13, margin: 4 }); }
    catch (e) { svg.innerHTML = ''; }
  }
  function ean13(d12) { let s = 0; for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1); return d12 + ((10 - (s % 10)) % 10); }
  function nextBarcode() {
    // รหัสภายในร้าน: ขึ้นต้น 200 (ช่วงที่ GS1 สงวนไว้ใช้ภายในร้าน ไม่ชนกับสินค้าจริง)
    const used = S.products.map(p => p.barcode || '').filter(b => /^200\d{10}$/.test(b)).map(b => Number(b.slice(3, 12)));
    return ean13('200' + String((used.length ? Math.max(...used) : 0) + 1).padStart(9, '0'));
  }
  async function resizeImage(file, max) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
  }

  // ---- labels (owner)
  function viewLabels() {
    S.labelQty = S.labelQty || {};
    const q = (S.labQ || '').toLowerCase();
    const list = S.products.filter(p => p.active !== false && (!q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)));
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('labels'), `<button class="btn-pay" data-act="printLabels"><i class="ti ti-printer"></i> ${t('printNow')}</button>`)}
      <p class="hint">${t('labelsHint')}</p>
      <div class="searchbar"><i class="ti ti-search"></i><input id="labQ" placeholder="${t('search2')}" value="${esc(S.labQ || '')}" autocomplete="off"></div>
      <div class="card mt">${list.slice(0, 200).map(p => `<div class="lrow">${thumb(p, 'cimg')}<span class="grow">${esc(p.name)}<small>${p.barcode ? esc(p.barcode) : t('noBarcode')}</small></span>
        ${p.barcode ? `<label class="field inline"><span>${t('copies')}</span><input data-label="${p.id}" inputmode="numeric" value="${esc(S.labelQty[p.id] || '')}" placeholder="0"></label>` : `<button class="btn sm" data-act="prodEdit" data-id="${p.id}">${t('edit')}</button>`}</div>`).join('')}</div></div>`;
  }
  async function printLabels() {
    const ids = Object.keys(S.labelQty).filter(id => num(S.labelQty[id]) > 0 && prodById(id) && prodById(id).barcode);
    if (!ids.length) return toast(t('needItems'), 'err');
    try { await loadScript(LIB.barcode); } catch (e) { return toast(t('network'), 'err'); }
    const html = ids.flatMap(id => { const p = prodById(id); return Array.from({ length: Math.min(200, num(S.labelQty[id])) }, () => `<div class="label"><div class="lname">${esc(p.name)}</div><svg class="lbc" data-code="${esc(p.barcode)}"></svg><div class="lprice">${lak(p.price)}</div></div>`); }).join('');
    $('#print-area').innerHTML = `<div class="labels">${html}</div>`;
    document.querySelectorAll('#print-area .lbc').forEach(svg => { const v = svg.dataset.code; try { window.JsBarcode(svg, v, { format: /^\d{13}$/.test(v) ? 'EAN13' : 'CODE128', height: 32, fontSize: 11, margin: 0, width: 1.4 }); } catch (e) { svg.outerHTML = `<div>${esc(v)}</div>`; } });
    printHtml($('#print-area').innerHTML, 'print-labels');
  }

  // ---- expenses (owner)
  const EXP = ['staff', 'rent', 'utilities', 'transport', 'other'];
  async function viewExpenses() {
    S.month = S.month || ymd(new Date()).slice(0, 7);
    loading();
    const r = monthRange(S.month);
    let rows = [];
    try { rows = await db.listExpenses(r.fromDate, r.toDate); } catch (e) { toast(errMsg(e), 'err'); }
    if (S.page !== 'expenses') return;
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('expenses'), `<input type="month" id="monthIn" value="${S.month}">`)}
      <form class="card" data-form="expense"><div class="grid4">
        <label class="field"><span>${t('date')}</span><input type="date" name="spent_on" value="${ymd(new Date())}" required></label>
        <label class="field"><span>${t('category')}</span><select name="category">${EXP.map(c => `<option value="${c}">${t('exp_' + c)}</option>`).join('')}</select></label>
        <label class="field"><span>${t('amount')} (${t('lakName')})</span><input name="amount" data-money inputmode="numeric" required></label>
        <label class="field"><span>${t('note')}</span><input name="note"></label></div>
        <button class="btn-pay" type="submit"><i class="ti ti-plus"></i> ${t('addExpense')}</button></form>
      <div class="kpis mt">${EXP.map(c => `<div class="kpi"><span>${t('exp_' + c)}</span><b>${lak(sum(rows.filter(x => x.category === c), x => Number(x.amount)))}</b></div>`).join('')}</div>
      <div class="card mt">${rows.length ? rows.map(x => `<div class="lrow"><span class="w100">${dmy(x.spent_on)}</span><span class="grow">${t('exp_' + x.category)}<small>${esc(x.note || '')}</small></span><b>${lak(x.amount)}</b><button class="icon-btn" data-act="expDel" data-id="${x.id}" aria-label="${t('delete')}"><i class="ti ti-trash"></i></button></div>`).join('') : `<p class="muted">-</p>`}</div></div>`;
  }

  // ---- reports (owner)
  async function viewReports() {
    S.month = S.month || ymd(new Date()).slice(0, 7);
    loading();
    const r = monthRange(S.month);
    let sales = [], items = [], cod = [], rec = [];
    try {
      [sales, items, cod, rec] = await Promise.all([db.listSales(r.from, r.to), db.listSaleItems(r.from, r.to), db.listCodPaidItems(r.from, r.to), db.listReceipts(r.from, r.to)]);
    } catch (e) { toast(errMsg(e), 'err'); }
    if (S.page !== 'reports') return;
    const done = sales.filter(s => s.status === 'done');
    const revPos = sum(done, s => Number(s.total));
    const revCod = sum(cod, i => i.price * i.qty);
    const revenue = revPos + revCod;
    const cogs = sum(items, i => i.cost * i.qty) + sum(cod, i => i.cost * i.qty);
    const gross = revenue - cogs;
    const purchases = sum(rec, x => Number(x.unit_cost) * x.qty);
    const byProd = {};
    for (const i of [...items, ...cod]) {
      const k = i.product_id || i.name;
      const b = byProd[k] || (byProd[k] = { name: i.name, qty: 0, rev: 0, cost: 0 });
      b.qty += i.qty; b.rev += i.price * i.qty; b.cost += i.cost * i.qty;
    }
    const prodRows = Object.values(byProd).sort((a, b) => (b.rev - b.cost) - (a.rev - a.cost));
    const days = {};
    for (const s of done) { const k = ymd(new Date(s.created_at)); days[k] = (days[k] || 0) + Number(s.total); }
    const [y, m] = S.month.split('-').map(Number);
    const nDays = new Date(y, m, 0).getDate();
    const dayVals = Array.from({ length: nDays }, (_, i) => days[`${y}-${pad(m)}-${pad(i + 1)}`] || 0);
    const maxDay = Math.max(1, ...dayVals);
    const methods = ['cash', 'qr', 'credit'].map(k => [t(k), sum(done.filter(s => s.pay_method === k), s => Number(s.total))]).concat([[t('codSales'), revCod]]);
    const bar = (label, v, max) => `<div class="hbar"><span>${label}</span><div><i style="width:${max ? Math.max(1, v / max * 100) : 0}%"></i></div><b>${lak(v)}</b></div>`;
    $('#main').innerHTML = `<div class="wrap">
      ${pageHead(t('reports'), `<input type="month" id="monthIn" value="${S.month}">`)}
      <div class="kpis">
        <div class="kpi"><span>${t('revenue')}</span><b>${lak(revenue)}</b><small>${done.length} ${t('bills')} · ${t('avgBill')} ${lak(done.length ? revPos / done.length : 0)}</small></div>
        <div class="kpi"><span>${t('cogs')}</span><b>${lak(cogs)}</b></div>
        <div class="kpi hl ${gross < 0 ? 'neg-bg' : ''}"><span>${t('gross')}</span><b>${lak(gross)}</b><small>${revenue ? Math.round(gross / revenue * 100) : 0}%</small></div>
        <div class="kpi"><span>${t('purchases')}</span><b>${lak(purchases)}</b></div>
      </div>
      <p class="hint">${t('grossNote')}</p>
      <div class="card mt"><h3>${t('daily')} <small class="muted">(${t('posOnly')})</small></h3>
        <div class="vbars">${dayVals.map((v, i) => `<div class="vb" title="${i + 1}: ${lak(v)}"><i style="height:${v / maxDay * 100}%"></i><span>${(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}</span></div>`).join('')}</div></div>
      <div class="card mt"><h3>${t('byMethod')}</h3>${methods.map(([k, v]) => bar(k, v, revenue)).join('')}</div>
      <div class="card mt"><h3>${t('byProduct')}</h3>
        <div class="table"><div class="trow head"><span class="grow">${t('name')}</span><span class="w60 r">${t('sold')}</span><span class="w100 r">${t('revenue')}</span><span class="w100 r">${t('cogs')}</span><span class="w100 r">${t('gross')}</span></div>
        ${prodRows.slice(0, 100).map(b => `<div class="trow"><span class="grow">${esc(b.name)}</span><span class="w60 r">${b.qty}</span><span class="w100 r">${lak(b.rev)}</span><span class="w100 r muted">${lak(b.cost)}</span><b class="w100 r ${b.rev - b.cost < 0 ? 'neg' : 'pos-t'}">${lak(b.rev - b.cost)}</b></div>`).join('') || '<p class="muted">-</p>'}</div></div>
    </div>`;
  }

  // ---- settings (owner)
  async function viewSettings() {
    loading();
    let users = [];
    try { S.settings = await db.getSettings(); users = await db.listUsers(); } catch (e) { toast(errMsg(e), 'err'); }
    if (S.page !== 'settings') return;
    const st = S.settings;
    $('#main').innerHTML = `<div class="wrap narrow">
      ${pageHead(t('settings'))}
      <form class="card" data-form="settings">
        <label class="field"><span>${t('shopName')}</span><input name="shop_name" value="${esc(st.shop_name || '')}"></label>
        <label class="field"><span>${t('rate')}</span><input name="rate_thb" inputmode="decimal" value="${esc(st.rate_thb || '')}" placeholder="0"></label>
        <label class="field"><span>${t('warnDays')}</span><input name="expiry_warn_days" inputmode="numeric" value="${esc(st.expiry_warn_days || '30')}"></label>
        <button class="btn-pay" type="submit">${t('saveSettings')}</button></form>
      <div class="card mt"><h3>${t('users')}</h3>
        ${users.map(u => `<div class="lrow"><span class="grow">${esc(u.display_name || u.username)}<small>${esc(u.username)}</small></span>
          ${db.mode === 'live' && u.id !== S.me.id ? `<select data-role="${u.id}" class="w-auto">${['owner', 'cashier'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${t('role_' + r)}</option>`).join('')}</select>` : `<span class="tag">${t('role_' + u.role)}</span>`}
          <button class="btn sm" data-act="pwOpen" data-id="${u.id}" data-name="${esc(u.username)}"><i class="ti ti-key"></i> ${t('resetPw')}</button></div>`).join('')}
        ${db.mode === 'live' ? `<p class="hint">${t('addUserHint', { domain: esc(C.loginDomain) })}</p>` : ''}</div>
      ${db.mode === 'demo' ? `<div class="card mt"><button class="btn-danger" data-act="resetDemo">${t('resetDemo')}</button></div>` : ''}
    </div>`;
  }

  // ------------------------------------------------------------ actions
  const ACT = {
    menu() { document.body.classList.add('menu-open'); },
    closeMenu() { document.body.classList.remove('menu-open'); },
    go(el) { go(el.dataset.page); },
    async logout() { await db.signOut(); S.me = null; S.cart = []; S.pay = null; S.page = 'pos'; document.body.classList.remove('menu-open'); render(); },
    lang(el) { S.lang = el.dataset.v; setPref('lang', S.lang); document.documentElement.lang = S.lang; if (S.me) render(); else renderLogin(); },
    cur(el) {
      if (el.dataset.v === 'THB' && !rate()) return toast(t('rateNotSet'), 'err');
      S.cur = el.dataset.v; render();
    },
    cat(el) { S.cat = el.dataset.v; drawPos(); },
    add(el, e) {
      const p = prodById(el.dataset.id); if (!p) return;
      const before = cartQty(p.id);
      S.bumpId = p.id;
      addToCart(p);
      S.bumpId = null;
      if (cartQty(p.id) > before) spark(e && e.clientX, e && e.clientY);
    },
    qty(el) {
      const l = S.cart.find(x => x.id === el.dataset.id); if (!l) return;
      const p = prodById(l.id), d = Number(el.dataset.v);
      if (d > 0 && l.qty + d > p.stock) { toast(t('out_of_stock', { d: p.name }), 'err'); return; }
      l.qty += d; if (l.qty <= 0) S.cart = S.cart.filter(x => x !== l);
      if (!S.cart.length) S.sheet = false;
      drawPos();
    },
    clearCart() { S.cart = []; S.pay = null; S.sheet = false; drawPos(); },
    sheet(el) { S.sheet = el.dataset.v === '1'; drawCart(); },
    checkout() {
      if (!S.cart.length) { toast(t('cartEmpty'), 'err'); return; }
      if (!S.shift) return openShiftModal();
      S.pay = { step: 'pay', method: 'cash', currency: S.cur === 'THB' && rate() ? 'THB' : 'LAK', amount: '', client_id: crypto.randomUUID(), busy: false };
      S.sheet = true;
      drawCart();
    },
    payBack() { if (S.pay && !S.pay.busy) { S.pay = null; drawCart(); } },
    payMethod(el) {
      S.pay.method = el.dataset.v;
      if (S.pay.method === 'credit' && !S.customers.length) db.listCustomers().then(c => { S.customers = c; drawCart(); }).catch(e => toast(errMsg(e), 'err'));
      drawCart();
    },
    payCur(el) { S.pay.currency = el.dataset.v; S.pay.amount = ''; drawCart(); },
    payQuick(el) { S.pay.amount = fmtNum(el.dataset.v); const a = $('#payAmt'); if (a) a.value = S.pay.amount; updChange(true); },
    pickCust(el) { S.pay.customer_id = el.dataset.id; drawCart(); },
    async newCustInline(el) {
      await withBusy(el, async () => {
        const c = await db.saveCustomer({ name: S.pay.custQ.trim() });
        S.customers.push(c); S.pay.customer_id = c.id; S.pay.custQ = c.name; drawCart();
      });
    },
    confirmSale(el) { confirmSale(el); },
    nextSale() { S.pay = null; S.sheet = false; drawPos(); const q = $('#q'); if (q && matchMedia('(min-width: 821px)').matches) q.focus(); },
    printReceipt() { if (S.pay && S.pay.sale) printHtml(receiptHtml(S.pay.sale, S.pay.lines), 'print-receipt'); },
    reprint() { const v = S.viewSale; if (v) printHtml(receiptHtml(v.sale, v.items), 'print-receipt'); },
    camera() {
      openCamera(code => { const p = findByCode(code); if (p) addToCart(p); else { toast(t('notFound', { d: code }), 'err'); beep(false); } });
    },
    pickCam(el) {
      const target = el.dataset.target;
      openCamera(code => { const p = findByCode(code); if (p) pickAdd(target, p); else { toast(t('notFound', { d: code }), 'err'); beep(false); } });
    },
    pick(el) { const p = prodById(el.dataset.id); if (p) pickAdd(el.dataset.target, p); },
    closeModal() { closeModal(); },
    openShiftModal() { openShiftModal(); },
    recvDel(el) { S.recv.rows.splice(Number(el.dataset.i), 1); viewReceive(); },
    recvSave(el) { recvSave(el); },
    recvFor(el) { const p = prodById(el.dataset.id); if (!p) return; go('receive'); pickAdd('recv', p); },
    codNew() { S.cod = { client_id: crypto.randomUUID(), customer_name: '', phone: '', courier: '', note: '', items: [] }; drawCodForm(); },
    codCourier(el) {
      // กดซ้ำ = ยกเลิกการเลือก · อัปเดตเฉพาะปุ่ม เพื่อไม่ให้ช่องที่กำลังพิมพ์หายโฟกัส
      S.cod.courier = S.cod.courier === el.dataset.v ? '' : el.dataset.v;
      selectCourierTile(el.parentElement, S.cod.courier);
    },
    shipCourier(el) {
      const inp = el.closest('form').elements.courier;
      inp.value = inp.value === el.dataset.v ? '' : el.dataset.v;
      selectCourierTile(el.parentElement, inp.value);
    },
    codEdit(el) {
      const o = (S.codOrders || []).find(x => x.id === el.dataset.id); if (!o) return;
      S.cod = {
        id: o.id, status: o.status, locked: o.status === 'paid' || o.status === 'returned',
        customer_name: o.customer_name || '', phone: o.phone || '', courier: o.courier || '', tracking: o.tracking || '', note: o.note || '',
        items: (o.items || []).map(i => ({ product_id: i.product_id, qty: i.qty, price: Number(i.price), name: i.name })),
      };
      drawCodForm();
      $('#codForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    codCancel() { S.cod = null; drawCodForm(); },
    codQty(el) {
      const it = S.cod.items.find(x => x.product_id === el.dataset.id); if (!it) return;
      it.qty += Number(el.dataset.v); if (it.qty <= 0) S.cod.items = S.cod.items.filter(x => x !== it);
      drawCodForm();
    },
    codSave(el) { codSave(el); },
    codFilter(el) { S.codFilter = el.dataset.v; drawCod(); },
    codStatus(el) { codStatus(el.dataset.id, el.dataset.v); },
    codStatusGo(el) { codStatusGo(el, el.dataset.id, el.dataset.v); },
    custNew() {
      modal(`<form data-form="customer"><div class="modal-head"><b>${t('addCustomer')}</b></div>
        <label class="field"><span>${t('customer')} *</span><input name="name" required></label>
        <label class="field"><span>${t('phone')}</span><input name="phone" inputmode="tel"></label>
        <label class="field"><span>${t('note')}</span><input name="note"></label>
        <div class="row end gap"><button type="button" class="btn" data-act="closeModal">${t('cancel')}</button><button class="btn-pay" type="submit">${t('save')}</button></div></form>`);
    },
    custOpen(el) { custOpen(el.dataset.id); },
    saleOpen(el) { saleOpen(el.dataset.id); },
    voidAsk(el) {
      $('#voidBox').innerHTML = `<form data-form="void" data-id="${el.dataset.id}" class="card flat mt"><label class="field"><span>${t('voidReason')}</span><input name="reason" required></label><button class="btn-danger" type="submit">${t('voidBill')}</button></form>`;
      $('#voidBox input').focus();
    },
    prodNew() { prodForm(null); },
    prodEdit(el) { prodForm(prodById(el.dataset.id)); },
    // เจ้าของตั้งรหัสผ่านใหม่ให้ผู้ใช้ (พนักงานลืมรหัส) · ผู้ใช้เดิมยังใช้ชื่อเดิม
    pwOpen(el) {
      if (!isOwner()) return;
      modal(`<form data-form="setPw" data-id="${esc(el.dataset.id)}"><div class="modal-head"><b><i class="ti ti-key"></i> ${t('resetPw')}</b></div>
        <div class="lrow"><span class="grow">${t('username')}<small>${esc(el.dataset.name)}</small></span></div>
        <label class="field"><span>${t('newPw')}</span><input name="pw" type="password" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span>${t('newPw2')}</span><input name="pw2" type="password" autocomplete="new-password" minlength="6" required></label>
        <label class="check"><input type="checkbox" data-act="pwShow"> ${t('showPw')}</label>
        <p class="hint">${t('pwHint')}</p>
        <div class="row end gap"><button type="button" class="btn" data-act="closeModal">${t('cancel')}</button><button class="btn-pay" type="submit">${t('save')}</button></div></form>`);
      $('#modal input[name=pw]').focus();
    },
    pwShow(el) { document.querySelectorAll('#modal input[name^=pw]').forEach(i => { i.type = el.checked ? 'text' : 'password'; }); },
    prodDel(el) {
      const p = prodById(el.dataset.id); if (!p) return;
      modal(`<div class="modal-head"><b><i class="ti ti-trash"></i> ${t('deleteProduct')}</b></div>
        <div class="lrow">${thumb(p, 'cimg')}<span class="grow">${esc(p.name)}<small>${t('stockNow')}: ${p.stock} ${esc(p.unit)}${p.barcode ? ' · ' + esc(p.barcode) : ''}</small></span></div>
        <p>${t('confirmDelProduct')}</p><p class="hint">${t('delProductNote')}</p>
        <div class="row end gap"><button class="btn" data-act="closeModal">${t('cancel')}</button><button class="btn-danger" data-act="prodDelGo" data-id="${p.id}">${t('delete')}</button></div>`);
    },
    async prodDelGo(el) {
      await withBusy(el, async () => {
        const r = await db.deleteProduct(el.dataset.id);
        S.cart = S.cart.filter(l => l.id !== el.dataset.id);
        await refreshProducts();
        closeModal();
        toast(r === 'archived' ? t('productArchived') : t('productDeleted'), 'ok');
        VIEWS[S.page]();
      });
    },
    genBarcode() { const i = $('#bcIn'); if (i && !i.value) { i.value = nextBarcode(); drawBarcodePreview(); } },
    labelFor(el) { S.labelQty = S.labelQty || {}; S.labelQty[el.dataset.id] = S.labelQty[el.dataset.id] || '1'; closeModal(); go('labels'); },
    printLabels() { printLabels(); },
    async expDel(el) { if (!confirm(t('confirmDelete'))) return; await withBusy(el, async () => { await db.deleteExpense(el.dataset.id); viewExpenses(); }); },
    async resetDemo() { if (!confirm(t('confirmReset'))) return; await db.resetDemo(); await db.signOut(); location.reload(); },
  };

  const FORMS = {
    async setPw(f) {
      const pw = f.elements.pw.value, pw2 = f.elements.pw2.value;
      if (pw.length < 6) return toast(t('weak_password'), 'err');
      if (pw !== pw2) return toast(t('pwMismatch'), 'err');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        await db.setPassword(f.dataset.id, pw);
        closeModal(); toast(t('pwChanged'), 'ok');
      });
    },
    async login(f) {
      const btn = f.querySelector('button[type=submit]');
      await withBusy(btn, async () => {
        S.me = await db.signIn(f.elements.u.value, f.elements.p.value);
        await loadCore();
        S.page = 'pos';
        render();
      });
    },
    async openShift(f) {
      await withBusy(f.querySelector('[type=submit]'), async () => {
        await db.openShift(num(f.elements.opening.value));
        S.shift = await db.currentShift();
        closeModal(); toast(t('shiftOpened'), 'ok'); render();
      });
    },
    async closeShift(f) {
      await withBusy(f.querySelector('[type=submit]'), async () => {
        const r = await db.closeShift(num(f.elements.lak.value), num(f.elements.thb.value), f.elements.note.value);
        S.shift = null; render(); shiftResult(r);
      });
    },
    async codShip(f) { await codStatusGo(f.querySelector('[type=submit]'), f.dataset.id, 'shipped', { courier: f.elements.courier.value, tracking: f.elements.tracking.value }); },
    async customer(f) {
      await withBusy(f.querySelector('[type=submit]'), async () => {
        await db.saveCustomer({ name: f.elements.name.value.trim(), phone: f.elements.phone.value, note: f.elements.note.value });
        closeModal(); viewDebts();
      });
    },
    async debtPay(f) {
      const amount = num(f.elements.amount.value);
      if (amount <= 0) return toast(t('amount'), 'err');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        await db.addDebtPayment(f.dataset.id, amount, f.elements.method.value, f.elements.note.value);
        closeModal(); toast(t('saved'), 'ok'); viewDebts();
      });
    },
    async void(f) {
      await withBusy(f.querySelector('[type=submit]'), async () => {
        await db.voidSale(f.dataset.id, f.elements.reason.value);
        await refreshProducts();
        closeModal(); toast(t('voidDone'), 'ok'); viewHistory();
      });
    },
    async product(f) {
      const E = f.elements;
      const name = E.name.value.trim(), price = num(E.price.value);
      if (!name || !E.price.value) return toast(t('needNamePrice'), 'err');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        let image_url = S.edit.image_url || null;
        if (S.edit.blob) image_url = await db.uploadImage(S.edit.blob);
        const row = {
          name, category: E.category.value.trim(), barcode: E.barcode.value.trim() || null, unit: E.unit.value.trim(),
          pack_size: Math.max(1, Math.round(num(E.pack_size.value) || 1)), price, stock: Math.round(num(E.stock.value)), min_stock: Math.round(num(E.min_stock.value)),
          active: E.active.checked, image_url,
        };
        if (S.edit.id) row.id = S.edit.id;
        await db.saveProduct(row, E.cost.value === '' ? null : num(E.cost.value));
        await refreshProducts();
        // กลับไปหน้าที่เปิดฟอร์มมา (สต็อก / สินค้า / พิมพ์บาร์โค้ด)
        closeModal(); toast(t('saved'), 'ok'); VIEWS[S.page]();
      });
    },
    async expense(f) {
      const E = f.elements;
      if (num(E.amount.value) <= 0) return toast(t('amount'), 'err');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        await db.saveExpense({ spent_on: E.spent_on.value, category: E.category.value, amount: num(E.amount.value), note: E.note.value });
        S.month = E.spent_on.value.slice(0, 7);
        toast(t('saved'), 'ok'); viewExpenses();
      });
    },
    async settings(f) {
      const E = f.elements;
      await withBusy(f.querySelector('[type=submit]'), async () => {
        await db.saveSettings({ shop_name: E.shop_name.value.trim(), rate_thb: String(dec(E.rate_thb.value)), expiry_warn_days: String(Math.round(num(E.expiry_warn_days.value)) || 30) });
        S.settings = await db.getSettings();
        if (!rate()) S.cur = 'LAK';
        toast(t('saved'), 'ok'); render();
      });
    },
  };

  // ------------------------------------------------------------ events
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const fn = ACT[a.dataset.act];
    if (!fn) return;
    if (a.tagName === 'BUTTON' && a.type !== 'submit') e.preventDefault();
    fn(a, e);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    FORMS[f.dataset.form](f);
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset && 'money' in el.dataset) formatMoneyInput(el, e);
    if (el.id === 'q') { S.q = el.value; drawPos(); return; }
    if (el.id === 'payAmt') { S.pay.amount = el.value; updChange(false); return; }
    if (el.id === 'custQ') { S.pay.custQ = el.value; const pos = el.selectionStart; drawCart(); const n = $('#custQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (el.dataset.picker) { pickerResults(el.dataset.picker, el.value); return; }
    if (el.dataset.recv != null) { S.recv.rows[Number(el.dataset.recv)][el.dataset.f] = el.value; return; }
    if (el.dataset.cod) { S.cod[el.dataset.cod] = el.value; return; }
    if (el.dataset.label) { S.labelQty[el.dataset.label] = el.value; return; }
    if (el.id === 'debtQ') { const pos = el.selectionStart; drawDebts(el.value); const n = $('#debtQ'); n.focus(); n.setSelectionRange(pos, pos); return; }
    if (el.id === 'prodQ' || el.id === 'labQ') { const k = el.id === 'prodQ' ? 'prodQ' : 'labQ'; S[k] = el.value; const pos = el.selectionStart; (k === 'prodQ' ? viewProducts : viewLabels)(); const n = $('#' + el.id); n.focus(); n.setSelectionRange(pos, pos); return; }
    if (el.id === 'bcIn') { drawBarcodePreview(); }
  });
  document.addEventListener('focusin', e => { const el = e.target; if (el.dataset && 'money' in el.dataset) el._prevMoney = el.value; });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.dataset.recv != null && el.dataset.f === 'by') { S.recv.rows[Number(el.dataset.recv)].by = el.value; S.recv.rows[Number(el.dataset.recv)].cost = ''; viewReceive(); return; }
    if (el.id === 'histDate') { S.histDate = el.value || ymd(new Date()); viewHistory(); return; }
    if (el.id === 'monthIn') { S.month = el.value || ymd(new Date()).slice(0, 7); VIEWS[S.page](); return; }
    if (el.dataset.role) { try { await db.setRole(el.dataset.role, el.value); toast(t('saved'), 'ok'); } catch (err) { toast(errMsg(err), 'err'); } return; }
    if (el.id === 'photoIn' && el.files[0]) {
      try {
        const blob = await resizeImage(el.files[0], db.mode === 'demo' ? 360 : 600);
        S.edit.blob = blob;
        $('#photoPrev').innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="">`;
      } catch (err) { toast(errMsg(err), 'err'); }
    }
  });
  document.addEventListener('keydown', e => {
    const el = e.target;
    if (e.key === 'Escape' && $('#modal').innerHTML) { closeModal(); return; }
    if (e.key === 'Enter' && el.id === 'q') {
      e.preventDefault();
      const code = el.value.trim(); if (!code) return;
      const p = findByCode(code) || (filtered().length === 1 ? filtered()[0] : null);
      if (p) { addToCart(p); el.value = ''; S.q = ''; drawPos(); }
      else { toast(t('notFound', { d: code }), 'err'); beep(false); el.select(); }
      return;
    }
    if (e.key === 'Enter' && el.dataset && el.dataset.picker) {
      e.preventDefault();
      const code = el.value.trim(); if (!code) return;
      const list = S.products.filter(p => p.name.toLowerCase().includes(code.toLowerCase()) || (p.barcode || '').includes(code));
      const p = findByCode(code) || (list.length === 1 ? list[0] : null);
      if (p) { const target = el.dataset.picker; pickAdd(target, p); const n = document.querySelector(`[data-picker="${target}"]`); if (n) { n.value = ''; n.focus(); } pickerResults(target, ''); }
      else { toast(t('notFound', { d: code }), 'err'); beep(false); }
      return;
    }
    if (e.key === 'Enter' && el.id === 'payAmt') { e.preventDefault(); confirmSale($('[data-act=confirmSale]')); return; }
    if (e.key === 'Enter' && el.id === 'bcIn') { e.preventDefault(); return; }
    // เครื่องยิงบาร์โค้ด USB พิมพ์ตัวเลขเหมือนคีย์บอร์ด: ถ้ายังไม่ได้โฟกัสช่องไหน ให้ส่งเข้าช่องค้นหาหน้าขาย
    if (S.page === 'pos' && !$('#modal').innerHTML && /^[0-9a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) { const q = $('#q'); if (q) q.focus(); }
    }
  });

  boot();
})();

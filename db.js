// ชั้นข้อมูล: ฟังก์ชันชุดเดียวกันทั้งโหมดเดโม (localStorage) และโหมดจริง (Supabase)
// เงินทุกยอดเก็บเป็นกีบ (LAK) · บาทใช้แค่ตอนรับเงินและแสดงผล
(function () {
  'use strict';

  class AppError extends Error {
    constructor(code, detail) { super(code); this.code = code; this.detail = detail || ''; }
  }
  window.AppError = AppError;

  const uid = () => crypto.randomUUID();
  const nowIso = () => new Date().toISOString();
  const inRange = (iso, from, to) => !!iso && (!from || iso >= from) && (!to || iso < to);

  // ล็อตที่ยังอยู่บนชั้น: เดินจากล็อตใหม่สุดย้อนกลับจนครบจำนวนสต็อก (เข้าก่อน ออกก่อน)
  function shelfLots(receipts, products, days) {
    const limit = new Date(); limit.setDate(limit.getDate() + days);
    const lim = limit.toISOString().slice(0, 10);
    const out = [];
    for (const p of products) {
      if (p.active === false || p.stock <= 0) continue;
      const rs = receipts.filter(r => r.product_id === p.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
      let before = 0;
      for (const r of rs) {
        if (before >= p.stock) break;
        const left = Math.min(r.qty, p.stock - before);
        if (r.expiry_date && r.expiry_date <= lim) out.push({ product_id: p.id, name: p.name, unit: p.unit, expiry_date: r.expiry_date, qty_left: left });
        before += r.qty;
      }
    }
    return out.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  }

  // ---------------------------------------------------------------- demo
  function createDemoDB(cfg) {
    const KEY = cfg.storageKey + ':demo';
    let d = load();
    let me = null;
    try { me = JSON.parse(sessionStorage.getItem(KEY + ':me')); } catch (e) { me = null; }

    function load() {
      try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return s; } catch (e) { /* fall through to seed */ }
      return seed();
    }
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { console.warn('demo save failed', e); }
    }
    function seed() {
      const P = [
        ['ນ້ຳດື່ມ 600ml', 'ເຄື່ອງດື່ມ', '8851952350017', 'ແກ້ວ', 'ແພັກ', 12, 5000, 3500, 36],
        ['ໂຄ້ກ 325ml', 'ເຄື່ອງດື່ມ', '8851959132012', 'ກະປ໋ອງ', 'ແກັດ', 24, 8000, 6000, 30],
        ['ເບຍລາວ 330ml', 'ເຄື່ອງດື່ມ', '8857100000017', 'ກະປ໋ອງ', 'ແກັດ', 24, 12000, 9500, 20],
        ['ກາເຟກະປ໋ອງ', 'ເຄື່ອງດື່ມ', '8850000000116', 'ກະປ໋ອງ', 'ແກັດ', 24, 9000, 6500, 12],
        ['ນົມກ່ອງ 200ml', 'ນົມ', '8850329112014', 'ກ່ອງ', 'ແພັກ', 4, 8000, 6000, 10],
        ['ໂຢເກິດ', 'ນົມ', '8850329900017', 'ຖ້ວຍ', 'ແພັກ', 4, 7000, 5000, 4],
        ['ມາມ່າ', 'ຂອງແຫ້ງ', '8850987101014', 'ຊອງ', 'ແກັດ', 30, 4000, 2800, 40],
        ['ໄຂ່ໄກ່', 'ຂອງແຫ້ງ', '', 'ໜ່ວຍ', 'ແຜງ', 30, 2500, 1800, 30],
        ['ເຂົ້າໜຽວ 1kg', 'ຂອງແຫ້ງ', '', 'ຖົງ', '', 1, 15000, 11000, 8],
        ['ຄຸກກີ້', 'ຂະໜົມ', '8850000000215', 'ຫໍ່', 'ກ່ອງ', 12, 6000, 4000, 3],
        ['ມັນຝຣັ່ງທອດ', 'ຂະໜົມ', '8850718801015', 'ຖົງ', 'ກ່ອງ', 12, 10000, 7000, 15],
        ['ເຂົ້າໜົມປັງ', 'ຂະໜົມ', '', 'ຖົງ', '', 1, 10000, 7500, 5],
        ['ສະບູ່', 'ຂອງໃຊ້', '8850006301013', 'ກ້ອນ', 'ກ່ອງ', 12, 9000, 6000, 12],
        ['ຢາສີຟັນ', 'ຂອງໃຊ້', '8850006320014', 'ຫຼອດ', 'ກ່ອງ', 12, 15000, 10500, 9],
        ['ເຈ້ຍທິດຊູ', 'ຂອງໃຊ້', '', 'ມ້ວນ', 'ແພັກ', 6, 5000, 3500, 24],
        ['ໝາກແອັບເປິ້ນ', 'ຜັກ-ໝາກໄມ້', '', 'ໜ່ວຍ', '', 1, 6000, 4000, 15],
      ];
      const s = {
        v: 1,
        settings: { shop_name: cfg.shopName, rate_thb: '650', expiry_warn_days: '30' },
        users: [
          { id: 'u-owner', username: 'owner', password: '1234', display_name: 'ເຈົ້າຂອງຮ້ານ', role: 'owner' },
          { id: 'u-staff', username: 'staff', password: '1234', display_name: 'ແກ້ວ', role: 'cashier' },
        ],
        products: [], costs: {}, receipts: [], shifts: [], customers: [], sales: [], sale_items: [],
        debt_entries: [], cod_orders: [], cod_items: [], expenses: [],
      };
      const day = 864e5;
      P.forEach((r, i) => {
        const id = uid();
        s.products.push({ id, name: r[0], category: r[1], barcode: r[2] || null, unit: r[3], pack_name: r[4], pack_size: r[5], price: r[6], stock: r[8], min_stock: 5, image_url: null, active: true, created_at: nowIso() });
        s.costs[id] = r[7];
        const exp = ['ນົມ', 'ຂະໜົມ'].includes(r[1]) ? new Date(Date.now() + (5 + i * 4) * day).toISOString().slice(0, 10) : null;
        s.receipts.push({ id: uid(), product_id: id, qty: r[8], unit_cost: r[7], expiry_date: exp, supplier: 'ຕົວຢ່າງ', note: '', created_by: 'u-owner', created_at: new Date(Date.now() - 3 * day).toISOString() });
      });
      s.customers.push({ id: uid(), name: 'ປ້າຄຳ (ຕົວຢ່າງ)', phone: '020 0000 0000', note: '', created_at: nowIso() });
      return s;
    }

    const ownerOnly = () => { if (!me || me.role !== 'owner') throw new AppError('forbidden'); };
    const authed = () => { if (!me) throw new AppError('not_authenticated'); };
    const prod = id => d.products.find(p => p.id === id);
    const openShift = () => d.shifts.find(s => !s.closed_at) || null;
    const userName = id => (d.users.find(u => u.id === id) || {}).display_name || '';
    const balanceOf = cid => d.debt_entries.filter(e => e.customer_id === cid).reduce((s, e) => s + (e.kind === 'charge' ? e.amount : -e.amount), 0);

    return {
      mode: 'demo',
      async session() { return me; },
      async signIn(username, password) {
        const u = d.users.find(x => x.username === username.trim().toLowerCase() && x.password === password);
        if (!u) throw new AppError('bad_login');
        me = { id: u.id, username: u.username, display_name: u.display_name, role: u.role };
        try { sessionStorage.setItem(KEY + ':me', JSON.stringify(me)); } catch (e) { /* session only */ }
        return me;
      },
      async signOut() { me = null; try { sessionStorage.removeItem(KEY + ':me'); } catch (e) { /* ignore */ } },
      async resetDemo() { d = seed(); save(); },

      async getSettings() { authed(); return { ...d.settings }; },
      async saveSettings(s) { ownerOnly(); Object.assign(d.settings, s); save(); },
      async listUsers() { ownerOnly(); return d.users.map(({ password, ...u }) => u); },
      async setRole() { throw new AppError('generic', 'demo'); },

      async listProducts() { authed(); return d.products.map(p => ({ ...p })); },
      async listCosts() { authed(); return { ...d.costs }; },
      async saveProduct(p, cost) {
        authed();
        const bc = p.barcode || null;
        if (bc && d.products.some(x => x.barcode === bc && x.id !== p.id)) throw new AppError('dup_barcode');
        let row = p.id && prod(p.id);
        if (row) Object.assign(row, p, { barcode: bc });
        else { row = { stock: 0, min_stock: 5, active: true, image_url: null, ...p, barcode: bc, id: uid(), created_at: nowIso() }; d.products.push(row); }
        if (cost != null) d.costs[row.id] = cost;
        save();
        return { ...row };
      },
      async uploadImage(blob) {
        return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
      },

      async receiveStock({ items, supplier, note }) {
        authed();
        for (const it of items) {
          const p = prod(it.product_id); if (!p) throw new AppError('generic', 'product');
          const old = d.costs[p.id] || 0;
          const c = it.unit_cost != null ? it.unit_cost : old;
          d.costs[p.id] = p.stock > 0 ? (p.stock * old + it.qty * c) / (p.stock + it.qty) : c;
          p.stock += it.qty;
          d.receipts.push({ id: uid(), product_id: p.id, qty: it.qty, unit_cost: c, expiry_date: it.expiry_date || null, supplier: supplier || '', note: note || '', created_by: me.id, created_at: nowIso() });
        }
        save();
      },
      async listReceipts(from, to) { ownerOnly(); return d.receipts.filter(r => inRange(r.created_at, from, to)).map(r => ({ ...r })); },
      async expiringSoon(days) { authed(); return shelfLots(d.receipts, d.products, days); },

      async currentShift() { authed(); const s = openShift(); return s ? { ...s, opened_by_name: userName(s.opened_by) } : null; },
      async openShift(opening) {
        authed();
        if (openShift()) return { ...openShift() };
        const s = { id: uid(), opened_by: me.id, opened_at: nowIso(), opening_cash: opening, closed_at: null };
        d.shifts.push(s); save(); return { ...s };
      },
      async closeShift(countedLak, countedThb, note) {
        authed();
        const s = openShift(); if (!s) throw new AppError('no_shift');
        const cash = d.sales.filter(x => x.shift_id === s.id && x.status === 'done' && x.pay_method === 'cash').reduce((a, x) => a + x.total, 0);
        const debt = d.debt_entries.filter(e => e.shift_id === s.id && e.kind === 'payment' && e.pay_method === 'cash').reduce((a, e) => a + e.amount, 0);
        const r = Number(d.settings.rate_thb) || 0;
        Object.assign(s, {
          closed_at: nowIso(), closed_by: me.id, expected_cash: s.opening_cash + cash + debt,
          counted_lak: countedLak, counted_thb: countedThb, rate_thb: r, note: note || '',
        });
        s.diff = countedLak + countedThb * r - s.expected_cash;
        save(); return { ...s, cash_sales: cash, debt_paid: debt };
      },
      async listShifts() { ownerOnly(); return d.shifts.filter(s => s.closed_at).sort((a, b) => b.opened_at.localeCompare(a.opened_at)).slice(0, 30).map(s => ({ ...s, opened_by_name: userName(s.opened_by) })); },

      async createSale(p) {
        authed();
        const dup = d.sales.find(s => s.client_id === p.client_id);
        if (dup) return { ...dup };
        const shift = openShift(); if (!shift) throw new AppError('no_shift');
        let total = 0;
        for (const it of p.items) {
          const pr = prod(it.product_id);
          if (!pr || pr.active === false) throw new AppError('generic', 'product');
          if (pr.stock < it.qty) throw new AppError('out_of_stock', pr.name);
          total += pr.price * it.qty;
        }
        const r = Number(d.settings.rate_thb) || 0;
        let paidLak = total;
        if (p.pay_method === 'cash') {
          if (p.paid_currency === 'THB' && !r) throw new AppError('rate_not_set');
          paidLak = p.paid_currency === 'THB' ? p.paid_amount * r : p.paid_amount;
          if (paidLak < total) throw new AppError('not_enough_cash');
        }
        if (p.pay_method === 'credit' && !p.customer_id) throw new AppError('pick_customer');
        const sale = {
          id: uid(), client_id: p.client_id, shift_id: shift.id, total, pay_method: p.pay_method,
          paid_currency: p.paid_currency || 'LAK', paid_amount: p.paid_amount || 0, rate_thb: r,
          change_lak: paidLak - total, customer_id: p.customer_id || null, status: 'done',
          created_by: me.id, created_at: nowIso(),
        };
        d.sales.push(sale);
        for (const it of p.items) {
          const pr = prod(it.product_id);
          d.sale_items.push({ id: uid(), sale_id: sale.id, product_id: pr.id, name: pr.name, qty: it.qty, price: pr.price, cost: d.costs[pr.id] || 0 });
          pr.stock -= it.qty;
        }
        if (p.pay_method === 'credit') d.debt_entries.push({ id: uid(), customer_id: p.customer_id, kind: 'charge', amount: total, sale_id: sale.id, shift_id: shift.id, pay_method: 'credit', note: '', created_by: me.id, created_at: nowIso() });
        save();
        return { ...sale };
      },
      async listSales(from, to) {
        authed();
        return d.sales.filter(s => inRange(s.created_at, from, to)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(s => ({ ...s, cashier: userName(s.created_by) }));
      },
      async listSaleItems(from, to) {
        ownerOnly();
        const ok = new Set(d.sales.filter(s => s.status === 'done' && inRange(s.created_at, from, to)).map(s => s.id));
        return d.sale_items.filter(i => ok.has(i.sale_id)).map(i => ({ ...i }));
      },
      async saleItemsOf(saleId) { ownerOnly(); return d.sale_items.filter(i => i.sale_id === saleId).map(i => ({ ...i })); },
      async voidSale(id, reason) {
        ownerOnly();
        const s = d.sales.find(x => x.id === id); if (!s || s.status === 'void') return;
        for (const i of d.sale_items.filter(x => x.sale_id === id)) { const p = prod(i.product_id); if (p) p.stock += i.qty; }
        Object.assign(s, { status: 'void', void_reason: reason, void_by: me.id, voided_at: nowIso() });
        d.debt_entries = d.debt_entries.filter(e => !(e.sale_id === id && e.kind === 'charge'));
        save();
      },

      async listCustomers() { authed(); return d.customers.map(c => ({ ...c, balance: balanceOf(c.id) })); },
      async saveCustomer(c) {
        authed();
        let row = c.id && d.customers.find(x => x.id === c.id);
        if (row) Object.assign(row, c); else { row = { phone: '', note: '', ...c, id: uid(), created_at: nowIso() }; d.customers.push(row); }
        save(); return { ...row, balance: balanceOf(row.id) };
      },
      async addDebtPayment(customerId, amount, method, note) {
        authed();
        const s = openShift();
        d.debt_entries.push({ id: uid(), customer_id: customerId, kind: 'payment', amount, sale_id: null, shift_id: s ? s.id : null, pay_method: method, note: note || '', created_by: me.id, created_at: nowIso() });
        save();
      },
      async listDebtEntries(customerId) { authed(); return d.debt_entries.filter(e => e.customer_id === customerId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(e => ({ ...e })); },

      async createCod(p) {
        authed();
        const dup = d.cod_orders.find(o => o.client_id === p.client_id); if (dup) return { ...dup };
        let sub = 0;
        for (const it of p.items) { const pr = prod(it.product_id); if (!pr) throw new AppError('generic', 'product'); if (pr.stock < it.qty) throw new AppError('out_of_stock', pr.name); sub += pr.price * it.qty; }
        const o = {
          id: uid(), client_id: p.client_id, customer_name: p.customer_name, fb_name: p.fb_name || '', phone: p.phone || '', address: p.address || '',
          items: p.items.map(it => { const pr = prod(it.product_id); return { product_id: pr.id, name: pr.name, qty: it.qty, price: pr.price }; }),
          subtotal: sub, shipping_fee: p.shipping_fee || 0, total: sub + (p.shipping_fee || 0), courier: p.courier || '', tracking: '',
          status: 'pending', note: p.note || '', paid_at: null, created_by: me.id, created_at: nowIso(), updated_at: nowIso(),
        };
        d.cod_orders.push(o);
        for (const it of p.items) { const pr = prod(it.product_id); d.cod_items.push({ id: uid(), cod_id: o.id, product_id: pr.id, name: pr.name, qty: it.qty, price: pr.price, cost: d.costs[pr.id] || 0 }); pr.stock -= it.qty; }
        save(); return { ...o };
      },
      // แก้ออเดอร์: items = null → แก้เฉพาะข้อมูลลูกค้า/ขนส่ง · มี items → ปรับสต็อกตามส่วนต่าง
      async updateCod(p) {
        authed();
        const o = d.cod_orders.find(x => x.id === p.id); if (!o) throw new AppError('generic', 'not_found');
        if (!String(p.customer_name || '').trim()) throw new AppError('need_customer');
        if (p.items) {
          if (o.status === 'paid' || o.status === 'returned') throw new AppError('status_locked');
          const sumBy = list => list.reduce((m, i) => (m[i.product_id] = (m[i.product_id] || 0) + i.qty, m), {});
          const oldLines = d.cod_items.filter(i => i.cod_id === o.id);
          const oldQ = sumBy(oldLines), newQ = sumBy(p.items);
          const ids = [...new Set([...Object.keys(oldQ), ...Object.keys(newQ)])];
          for (const id of ids) {
            const pr = prod(id); if (!pr) throw new AppError('generic', 'product');
            const delta = (newQ[id] || 0) - (oldQ[id] || 0);
            if (delta > 0 && pr.stock < delta) throw new AppError('out_of_stock', pr.name);
          }
          const lines = ids.filter(id => newQ[id] > 0).map(id => {
            const pr = prod(id), old = oldLines.find(i => i.product_id === id);
            return { id: uid(), cod_id: o.id, product_id: id, name: pr.name, qty: newQ[id], price: old ? old.price : pr.price, cost: old ? old.cost : d.costs[id] || 0 };
          });
          if (!lines.length) throw new AppError('needItems');
          for (const id of ids) prod(id).stock -= (newQ[id] || 0) - (oldQ[id] || 0);
          d.cod_items = d.cod_items.filter(i => i.cod_id !== o.id).concat(lines);
          o.items = lines.map(({ product_id, name, qty, price }) => ({ product_id, name, qty, price }));
          o.subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
          o.total = o.subtotal + (o.shipping_fee || 0);
        }
        Object.assign(o, { customer_name: p.customer_name.trim(), phone: p.phone || '', courier: p.courier || '', tracking: p.tracking || '', note: p.note || '', updated_at: nowIso() });
        save(); return { ...o };
      },
      async listCod() { authed(); return d.cod_orders.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300).map(o => ({ ...o })); },
      async setCodStatus(id, status, extra) {
        authed();
        const o = d.cod_orders.find(x => x.id === id); if (!o) return;
        if (o.status === 'paid' || o.status === 'returned') throw new AppError('status_locked');
        if (status === 'returned') for (const i of d.cod_items.filter(x => x.cod_id === id)) { const p = prod(i.product_id); if (p) p.stock += i.qty; }
        Object.assign(o, { status, updated_at: nowIso() });
        if (status === 'paid') o.paid_at = nowIso();
        if (extra && extra.courier != null) o.courier = extra.courier;
        if (extra && extra.tracking != null) o.tracking = extra.tracking;
        save();
      },
      async listCodPaidItems(from, to) {
        ownerOnly();
        const ok = new Set(d.cod_orders.filter(o => o.status === 'paid' && inRange(o.paid_at, from, to)).map(o => o.id));
        return d.cod_items.filter(i => ok.has(i.cod_id)).map(i => ({ ...i }));
      },

      async listExpenses(fromDate, toDate) { ownerOnly(); return d.expenses.filter(e => e.spent_on >= fromDate && e.spent_on < toDate).sort((a, b) => b.spent_on.localeCompare(a.spent_on)).map(e => ({ ...e })); },
      async saveExpense(e) { ownerOnly(); d.expenses.push({ note: '', ...e, id: uid(), created_by: me.id, created_at: nowIso() }); save(); },
      async deleteExpense(id) { ownerOnly(); d.expenses = d.expenses.filter(e => e.id !== id); save(); },
    };
  }

  // ---------------------------------------------------------------- supabase
  function createSupabaseDB(cfg) {
    if (!window.supabase) throw new Error('supabase-js not loaded');
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, storageKey: cfg.storageKey + ':auth' } });
    let me = null;

    // แปลง error ของ Supabase / เครือข่าย ให้เป็นรหัสที่หน้าจอรู้จัก
    function fail(error) {
      const m = (error && (error.message || String(error))) || '';
      if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(m) && !/permission/i.test(m)) throw new AppError('network');
      const known = m.match(/(out_of_stock|not_enough_cash|rate_not_set|no_shift|forbidden|status_locked|pick_customer|dup_barcode|need_customer|empty_cart)(?::(.*))?/);
      if (known) throw new AppError(known[1], known[2] || '');
      if (/duplicate key.*barcode/i.test(m)) throw new AppError('dup_barcode');
      if (/row-level security|permission denied/i.test(m)) throw new AppError('forbidden');
      throw new AppError('generic', m);
    }
    async function q(promise) {
      let res;
      try { res = await promise; } catch (e) { fail(e); }
      if (res.error) fail(res.error);
      return res.data;
    }
    // Supabase คืนครั้งละไม่เกิน 1000 แถว → ดึงทีละหน้าจนครบ
    async function all(build) {
      const out = [];
      for (let i = 0; ; i += 1000) {
        const rows = await q(build().range(i, i + 999));
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    }
    async function loadMe(user) {
      if (!user) { me = null; return null; }
      const p = await q(sb.from('profiles').select('id, username, display_name, role').eq('id', user.id).maybeSingle());
      me = p || null;
      return me;
    }

    return {
      mode: 'live',
      async session() {
        const { data } = await sb.auth.getSession();
        return loadMe(data.session && data.session.user);
      },
      async signIn(username, password) {
        const u = username.trim().toLowerCase();
        const email = u.includes('@') ? u : u + '@' + cfg.loginDomain;
        let res;
        try { res = await sb.auth.signInWithPassword({ email, password }); } catch (e) { fail(e); }
        if (res.error) { if (/invalid/i.test(res.error.message)) throw new AppError('bad_login'); fail(res.error); }
        const p = await loadMe(res.data.user);
        if (!p) throw new AppError('bad_login');
        return p;
      },
      async signOut() { await sb.auth.signOut(); me = null; },

      async getSettings() {
        const rows = await q(sb.from('settings').select('key, value'));
        return Object.fromEntries(rows.map(r => [r.key, r.value]));
      },
      async saveSettings(s) { await q(sb.from('settings').upsert(Object.entries(s).map(([key, value]) => ({ key, value: String(value) })))); },
      async listUsers() { return q(sb.from('profiles').select('id, username, display_name, role').order('username')); },
      async setRole(id, role) { await q(sb.from('profiles').update({ role }).eq('id', id)); },

      async listProducts() { return all(() => sb.from('products').select('*').order('name').order('id')); },
      async listCosts() {
        const rows = await all(() => sb.from('product_costs').select('product_id, avg_cost').order('product_id'));
        return Object.fromEntries(rows.map(r => [r.product_id, Number(r.avg_cost)]));
      },
      async saveProduct(p, cost) {
        const row = { ...p, barcode: p.barcode || null };
        const saved = row.id
          ? await q(sb.from('products').update(row).eq('id', row.id).select().single())
          : await q(sb.from('products').insert(row).select().single());
        if (cost != null) await q(sb.from('product_costs').upsert({ product_id: saved.id, avg_cost: cost }));
        return saved;
      },
      async uploadImage(blob) {
        const path = uid() + '.jpg';
        await q(sb.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }));
        return sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
      },

      async receiveStock(payload) { await q(sb.rpc('receive_stock', { p: payload })); },
      async listReceipts(from, to) { return all(() => sb.from('receipts').select('*').gte('created_at', from).lt('created_at', to).order('created_at').order('id')); },
      async expiringSoon(days) { return q(sb.rpc('expiring_soon', { p_days: days })); },

      async currentShift() {
        const s = await q(sb.from('shifts').select('*, profiles!shifts_opened_by_fkey(display_name)').is('closed_at', null).maybeSingle());
        return s ? { ...s, opened_by_name: s.profiles && s.profiles.display_name } : null;
      },
      async openShift(opening) { return q(sb.rpc('open_shift', { p_opening: opening })); },
      async closeShift(countedLak, countedThb, note) { return q(sb.rpc('close_shift', { p_counted_lak: countedLak, p_counted_thb: countedThb, p_note: note || '' })); },
      async listShifts() {
        const rows = await q(sb.from('shifts').select('*, profiles!shifts_opened_by_fkey(display_name)').not('closed_at', 'is', null).order('opened_at', { ascending: false }).limit(30));
        return rows.map(s => ({ ...s, opened_by_name: s.profiles && s.profiles.display_name }));
      },

      async createSale(p) { return q(sb.rpc('create_sale', { p })); },
      async listSales(from, to) {
        const rows = await all(() => sb.from('sales').select('*, profiles!sales_created_by_fkey(display_name)').gte('created_at', from).lt('created_at', to).order('created_at', { ascending: false }).order('id'));
        return rows.map(s => ({ ...s, total: Number(s.total), cashier: s.profiles && s.profiles.display_name }));
      },
      async listSaleItems(from, to) {
        const rows = await all(() => sb.from('sale_items').select('*, sales!inner(created_at, status)').eq('sales.status', 'done').gte('sales.created_at', from).lt('sales.created_at', to).order('id'));
        return rows.map(r => ({ ...r, price: Number(r.price), cost: Number(r.cost) }));
      },
      async saleItemsOf(saleId) { return q(sb.from('sale_items').select('*').eq('sale_id', saleId).order('id')); },
      async voidSale(id, reason) { await q(sb.rpc('void_sale', { p_id: id, p_reason: reason })); },

      async listCustomers() { return q(sb.rpc('customers_with_balance')); },
      async saveCustomer(c) {
        const row = c.id ? await q(sb.from('customers').update(c).eq('id', c.id).select().single()) : await q(sb.from('customers').insert(c).select().single());
        return { ...row, balance: 0 };
      },
      async addDebtPayment(customerId, amount, method, note) { await q(sb.rpc('add_debt_payment', { p_customer: customerId, p_amount: amount, p_method: method, p_note: note || '' })); },
      async listDebtEntries(customerId) { return q(sb.from('debt_entries').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(200)); },

      async createCod(p) { return q(sb.rpc('create_cod', { p })); },
      async updateCod(p) { return q(sb.rpc('update_cod', { p })); },
      async listCod() { return q(sb.from('cod_orders').select('*').order('created_at', { ascending: false }).limit(300)); },
      async setCodStatus(id, status, extra) { await q(sb.rpc('set_cod_status', { p_id: id, p_status: status, p_courier: extra && extra.courier, p_tracking: extra && extra.tracking })); },
      async listCodPaidItems(from, to) {
        const rows = await all(() => sb.from('cod_items').select('*, cod_orders!inner(status, paid_at)').eq('cod_orders.status', 'paid').gte('cod_orders.paid_at', from).lt('cod_orders.paid_at', to).order('id'));
        return rows.map(r => ({ ...r, price: Number(r.price), cost: Number(r.cost) }));
      },

      async listExpenses(fromDate, toDate) { return all(() => sb.from('expenses').select('*').gte('spent_on', fromDate).lt('spent_on', toDate).order('spent_on', { ascending: false }).order('id')); },
      async saveExpense(e) { await q(sb.from('expenses').insert(e)); },
      async deleteExpense(id) { await q(sb.from('expenses').delete().eq('id', id)); },
    };
  }

  window.createDB = cfg => (cfg.supabaseUrl ? createSupabaseDB(cfg) : createDemoDB(cfg));
})();

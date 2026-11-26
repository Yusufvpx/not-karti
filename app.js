// Not Kartı
const APP_VERSION = '1.0.0';
{
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('nk_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('nk_' + k, JSON.stringify(v)); } catch (e) {} }
};
const cmp = (a, b) => a.localeCompare(b, 'tr');
const CFG = window.NK_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false } });

let cards = [], byId = new Map(), loaded = false, editingId = null, lastDeleted = null;
let formImg = '', pendingFile = null;
const pending = LS.get('pending', {}); // çevrimdışıyken verilen cevaplar
const sel = { ders: LS.get('ders', ''), konu: LS.get('konu', ''), mod: LS.get('mod', 'hepsi'), kar: LS.get('kar', true) };
const ses = { queue: [], i: 0, dogru: 0, yanlis: 0, flipped: false, started: false };

/* ---------- veri dönüşümü ---------- */
const fromRow = r => ({ id: r.id, ders: r.ders || 'Genel', konu: r.konu || 'Genel', on: r.on_yuz || '', arka: r.arka || '',
  resim: r.resim || '', durum: r.durum || 'yeni', dogru: r.dogru || 0, yanlis: r.yanlis || 0, t: Date.parse(r.created_at) || 0 });
const imgOk = p => typeof p === 'string' && /^[A-Za-z0-9._-]{4,120}$/.test(p);
const imgUrl = p => `${CFG.url}/storage/v1/object/public/${CFG.bucket}/${encodeURIComponent(p)}`;

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, undo) {
  $('#toast-t').textContent = msg; const b = $('#toast-b'); b.hidden = !undo;
  b.onclick = undo ? () => { undo(); hideToast(); } : null;
  $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, undo ? 6000 : 3500);
}
function hideToast() { $('#toast').classList.remove('show'); }
function setSync(state, text) { const s = $('#sync'); s.className = 'sync ' + state; s.querySelector('span').textContent = text; }

/* ---------- sekmeler ---------- */
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.body.dataset.tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
  window.scrollTo(0, 0);
}));

/* ---------- yardımcılar ---------- */
const dersler = () => [...new Set(cards.map(c => c.ders))].sort(cmp);
const konular = d => [...new Set(cards.filter(c => !d || c.ders === d).map(c => c.konu))].sort(cmp);
const inSel = c => (!sel.ders || c.ders === sel.ders) && (!sel.konu || c.konu === sel.konu);
const pool = () => cards.filter(c => inSel(c) &&
  (sel.mod === 'hepsi' || (sel.mod === 'bilmiyorum' ? c.durum === 'bilmiyorum' : c.durum !== 'biliyorum')));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- çalışma filtreleri ---------- */
function renderFilters() {
  const ds = dersler(); if (sel.ders && !ds.includes(sel.ders)) sel.ders = '';
  $('#s-ders').innerHTML = '<option value="">Tüm dersler</option>' + ds.map(d => `<option${d === sel.ders ? ' selected' : ''}>${esc(d)}</option>`).join('');
  const ks = konular(sel.ders); if (sel.konu && !ks.includes(sel.konu)) sel.konu = '';
  $('#s-konu').innerHTML = '<option value="">Tüm konular</option>' + ks.map(k => `<option${k === sel.konu ? ' selected' : ''}>${esc(k)}</option>`).join('');
  document.querySelectorAll('#s-mod button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mod === sel.mod));
  $('#s-kar').checked = !!sel.kar;
}
function saveSel() { LS.set('ders', sel.ders); LS.set('konu', sel.konu); LS.set('mod', sel.mod); LS.set('kar', sel.kar); }
$('#s-ders').addEventListener('change', e => { sel.ders = e.target.value; sel.konu = ''; saveSel(); renderFilters(); start(); });
$('#s-konu').addEventListener('change', e => { sel.konu = e.target.value; saveSel(); start(); });
$('#s-mod').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; sel.mod = b.dataset.mod; saveSel(); renderFilters(); start(); });
$('#s-kar').addEventListener('change', e => { sel.kar = e.target.checked; saveSel(); start(); });
$('#s-restart').addEventListener('click', start);

/* ---------- çalışma turu ---------- */
function start() {
  const ids = pool().map(c => c.id);
  Object.assign(ses, { queue: sel.kar ? shuffle(ids) : ids, i: 0, dogru: 0, yanlis: 0, flipped: false, started: true });
  renderStage();
}
function current() { while (ses.i < ses.queue.length && !byId.has(ses.queue[ses.i])) ses.i++; return byId.get(ses.queue[ses.i]); }
function flip() { const el = $('#card'); if (!el) return; ses.flipped = !ses.flipped; el.classList.toggle('flipped', ses.flipped); renderActs(); }

async function answer(known) {
  const c = current(); if (!c || !ses.flipped) return;
  if (known) ses.dogru++; else { ses.yanlis++; ses.queue.splice(Math.min(ses.queue.length, ses.i + 4), 0, c.id); }
  const patch = { durum: known ? 'biliyorum' : 'bilmiyorum', dogru: c.dogru + (known ? 1 : 0), yanlis: c.yanlis + (known ? 0 : 1) };
  Object.assign(c, patch); saveCache();
  ses.i++; ses.flipped = false; renderStage();
  pending[c.id] = { ...patch, son: new Date().toISOString(), updated_at: new Date().toISOString() };
  LS.set('pending', pending); flushPending();
}
let flushing = false;
async function flushPending() {
  if (flushing || !navigator.onLine) return; flushing = true;
  for (const id of Object.keys(pending)) {
    const { error } = await sb.from('cards').update(pending[id]).eq('id', id);
    if (error) break;
    delete pending[id]; LS.set('pending', pending);
  }
  flushing = false;
}
addEventListener('online', () => { flushPending(); load(); });

function fillFront(c) {
  const b = $('#c-on'); if (!b) return; b.textContent = ''; b.classList.toggle('pic', imgOk(c.resim));
  if (imgOk(c.resim)) {
    const im = new Image(); im.alt = c.on || 'Kart resmi'; im.src = imgUrl(c.resim);
    im.onerror = () => im.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Resim yüklenemedi' }));
    b.append(im);
    if (c.on) { const s = document.createElement('span'); s.textContent = c.on; b.append(s); }
  } else b.textContent = c.on;
}

function renderStage() {
  const st = $('#stage');
  if (!loaded) { st.innerHTML = '<div class="empty"><h2>Kartlar yükleniyor…</h2></div>'; return; }
  if (!cards.length) { st.innerHTML = `<div class="empty"><h2>Henüz kart yok</h2><p>Kartlar bölümünden kart ekleyin.</p><button class="btn pri" data-go="kartlar">Kart ekle</button></div>`; return; }
  const total = ses.queue.length;
  if (!total) {
    st.innerHTML = `<div class="empty"><h2>Bu seçimde kart yok</h2><p>${sel.mod === 'bilmiyorum' ? 'Bilmiyorum diye işaretlediğiniz kart kalmadı.' : sel.mod === 'ogrenilmemis' ? 'Bu bölümdeki bütün kartları biliyorsunuz.' : 'Başka bir ders ya da konu seçin.'}</p><button class="btn" data-mod-all>Hepsini göster</button></div>`;
    return;
  }
  const c = current();
  if (!c) {
    const anyWrong = cards.some(x => inSel(x) && x.durum === 'bilmiyorum');
    st.innerHTML = `<div class="empty"><h2>Tur bitti</h2><div class="sum"><div><b>${ses.dogru}</b>Biliyorum</div><div><b>${ses.yanlis}</b>Bilmiyorum</div></div>
    <div class="row" style="justify-content:center"><button class="btn pri" id="again">Yeniden çalış</button>${anyWrong ? '<button class="btn" id="wrong">Bilmediklerimi çalış</button>' : ''}<button class="btn ghost" id="reset">İlerlemeyi sıfırla</button></div></div>`;
    return;
  }
  const done = Math.min(ses.i, total);
  st.innerHTML = `<div class="prog"><span>${done + 1} / ${total}</span><div class="bar"><b style="width:${(done / total * 100).toFixed(1)}%"></b></div></div>
  <div class="scene"><div class="stack"></div><div class="card3d${ses.flipped ? ' flipped' : ''}" id="card" role="button" tabindex="0" aria-label="Kartı çevir">
    <div class="face front"><div class="tag"><span>${esc(c.ders)} · ${esc(c.konu)}</span><span class="hand">Ne demek?</span></div><div class="body" id="c-on"></div></div>
    <div class="face back"><div class="tag"><span>${esc(c.on || 'Resim')}</span><span class="hand">Cevap</span></div><div class="body" id="c-arka"></div></div>
  </div></div>
  <div class="acts" id="acts"></div>
  <p class="hint">Kartın üstüne dokunarak çevirin<span class="kb"> · Klavye: Boşluk çevirir, ← bilmiyorum, → biliyorum</span></p>`;
  fillFront(c); $('#c-arka').textContent = c.arka;
  renderActs();
}
function renderActs() {
  const a = $('#acts'); if (!a) return;
  a.innerHTML = ses.flipped ? '<button class="btn no" data-ans="0">Bilmiyorum</button><button class="btn yes" data-ans="1">Biliyorum</button>'
    : '<button class="btn pri full" id="flipb">Çevir ve cevabı gör</button>';
}
$('#stage').addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('#card') || t.closest('#flipb')) return flip();
  const ans = t.closest('[data-ans]'); if (ans) return answer(ans.dataset.ans === '1');
  if (t.closest('[data-go]')) return $('#tab-kartlar').click();
  if (t.closest('[data-mod-all]')) { sel.mod = 'hepsi'; saveSel(); renderFilters(); return start(); }
  if (t.closest('#again')) return start();
  if (t.closest('#wrong')) { sel.mod = 'bilmiyorum'; saveSel(); renderFilters(); return start(); }
  const r = t.closest('#reset');
  if (r) {
    if (!r.dataset.c) { r.dataset.c = 1; r.textContent = 'Emin misiniz? Bu seçimdeki ilerleme silinir'; setTimeout(() => { if (r.isConnected) { delete r.dataset.c; r.textContent = 'İlerlemeyi sıfırla'; } }, 4000); return; }
    r.disabled = true; r.textContent = 'Sıfırlanıyor…';
    const ids = cards.filter(c => inSel(c) && c.durum !== 'yeni').map(c => c.id);
    const { error } = ids.length ? await sb.from('cards').update({ durum: 'yeni', dogru: 0, yanlis: 0, updated_at: new Date().toISOString() }).in('id', ids) : { error: null };
    if (error) toast('Sıfırlama yapılamadı, internet bağlantısını kontrol edin.');
    else { ids.forEach(id => Object.assign(byId.get(id), { durum: 'yeni', dogru: 0, yanlis: 0 })); saveCache(); toast('İlerleme sıfırlandı.'); }
    sel.mod = 'hepsi'; saveSel(); renderFilters(); renderManager(); start();
  }
});
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select')) return;
  if (document.body.dataset.tab !== 'calis' && innerWidth < 900) return;
  if (!$('#card')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
  else if (e.key === 'ArrowLeft' && ses.flipped) answer(false);
  else if (e.key === 'ArrowRight' && ses.flipped) answer(true);
});

/* ---------- kart yönetimi ---------- */
function renderManager() {
  $('#dl-ders').innerHTML = dersler().map(d => `<option value="${esc(d)}">`).join('');
  $('#dl-konu').innerHTML = konular($('#f-ders').value.trim()).map(k => `<option value="${esc(k)}">`).join('');
  const q = $('#q').value.trim().toLocaleLowerCase('tr');
  const list = cards.filter(c => !q || (c.on + ' ' + c.arka + ' ' + c.ders + ' ' + c.konu).toLocaleLowerCase('tr').includes(q));
  if (!list.length) { $('#list').innerHTML = `<p style="color:var(--mute);font-size:14px;margin-top:16px">${cards.length ? 'Aramaya uyan kart yok.' : 'Kartlarınız burada listelenecek.'}</p>`; return; }
  const groups = {};
  for (const c of list) ((groups[c.ders] ??= {})[c.konu] ??= []).push(c);
  $('#list').innerHTML = Object.keys(groups).sort(cmp).map(d => {
    const ks = groups[d], n = Object.values(ks).reduce((s, a) => s + a.length, 0);
    return `<div class="grp"><h3><span>${esc(d)}</span><span style="font-weight:400;color:var(--mute)">${n} kart</span></h3>` +
      Object.keys(ks).sort(cmp).map(k => `<h4>${esc(k)}</h4>` + ks[k].map(c => `<div class="item"><i class="dot ${esc(c.durum)}"></i>${imgOk(c.resim) ? `<img class="thumb" alt="" loading="lazy" src="${esc(imgUrl(c.resim))}">` : ''}<div class="t"><b>${esc(c.on || '(Resimli kart)')}</b><p>${esc(c.arka)}</p></div><button class="btn" data-edit="${esc(c.id)}">Düzenle</button><button class="btn ghost" data-del="${esc(c.id)}">Sil</button></div>`).join('')).join('') + '</div>';
  }).join('');
}
$('#q').addEventListener('input', renderManager);
$('#f-ders').addEventListener('change', () => { $('#dl-konu').innerHTML = konular($('#f-ders').value.trim()).map(k => `<option value="${esc(k)}">`).join(''); });
$('#f-ders').value = LS.get('fders', ''); $('#f-konu').value = LS.get('fkonu', '');

function setFormImg(path, file) {
  formImg = path || ''; pendingFile = file || null; const p = $('#f-prev');
  if (p.src.startsWith('blob:')) URL.revokeObjectURL(p.src);
  if (file) { p.src = URL.createObjectURL(file); p.hidden = false; }
  else if (imgOk(formImg)) { p.src = imgUrl(formImg); p.hidden = false; }
  else { p.removeAttribute('src'); p.hidden = true; }
  $('#f-imgdel').hidden = p.hidden;
}
['#f-img', '#f-cam'].forEach(s => $(s).addEventListener('change', e => { const f = e.target.files[0]; if (f) setFormImg(formImg, f); e.target.value = ''; }));
$('#f-imgdel').addEventListener('click', () => setFormImg('', null));
$('#form').addEventListener('paste', e => {
  const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); if (!it) return;
  e.preventDefault(); const f = it.getAsFile(); if (f) { setFormImg(formImg, f); toast('Resim eklendi.'); }
});
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise(r => cv.toBlob(b => r(b || file), 'image/jpeg', .85));
  } catch (e) { return file; }
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function endEdit() {
  editingId = null; $('#f-title').textContent = 'Kart ekle'; $('#f-save').textContent = 'Kartı ekle'; $('#f-cancel').hidden = true;
  $('#f-on').value = ''; $('#f-arka').value = ''; setFormImg('', null);
}
$('#f-cancel').addEventListener('click', endEdit);
$('#list').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const c = byId.get(ed.dataset.edit); if (!c) return; editingId = c.id;
    $('#f-ders').value = c.ders; $('#f-konu').value = c.konu; $('#f-on').value = c.on; $('#f-arka').value = c.arka; setFormImg(c.resim, null);
    $('#f-title').textContent = 'Kartı düzenle'; $('#f-save').textContent = 'Kaydet'; $('#f-cancel').hidden = false;
    $('#kartlar').scrollTo?.({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    if (!del.dataset.c) { del.dataset.c = 1; del.textContent = 'Emin misiniz?'; setTimeout(() => { if (del.isConnected) { delete del.dataset.c; del.textContent = 'Sil'; } }, 3000); return; }
    const c = byId.get(del.dataset.del); if (!c) return;
    const { error } = await sb.from('cards').delete().eq('id', c.id);
    if (error) { toast('Kart silinemedi, internet bağlantısını kontrol edin.'); return; }
    if (editingId === c.id) endEdit();
    lastDeleted = c; removeLocal(c.id);
    toast('Kart silindi.', async () => {
      const d = lastDeleted;
      const { data, error: err } = await sb.from('cards').insert({ id: d.id, ders: d.ders, konu: d.konu, on_yuz: d.on, arka: d.arka, resim: d.resim || null, durum: d.durum, dogru: d.dogru, yanlis: d.yanlis }).select().single();
      if (err) toast('Geri alınamadı.'); else upsertLocal(data);
    });
  }
});
$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const ders = $('#f-ders').value.trim(), konu = $('#f-konu').value.trim() || 'Genel', on = $('#f-on').value.trim(), arka = $('#f-arka').value.trim();
  if (!ders || !arka) return;
  if (!on && !pendingFile && !formImg) { toast('Ön yüze bir kavram yazın ya da resim ekleyin.'); $('#f-on').focus(); return; }
  const btn = $('#f-save'); btn.disabled = true;
  try {
    let resim = formImg;
    if (pendingFile) {
      btn.textContent = 'Resim yükleniyor…';
      const path = uuid() + '.jpg';
      const { error } = await sb.storage.from(CFG.bucket).upload(path, await shrink(pendingFile), { contentType: 'image/jpeg', cacheControl: '31536000' });
      if (error) throw error;
      resim = path;
    }
    const row = { ders, konu, on_yuz: on, arka, resim: resim || null, updated_at: new Date().toISOString() };
    if (editingId) {
      const { data, error } = await sb.from('cards').update(row).eq('id', editingId).select().single();
      if (error) throw error; upsertLocal(data); toast('Kart güncellendi.'); endEdit();
    } else {
      const { data, error } = await sb.from('cards').insert(row).select().single();
      if (error) throw error; upsertLocal(data);
      if (ses.started && inSel(fromRow(data)) && sel.mod !== 'bilmiyorum') ses.queue.push(data.id);
      $('#f-on').value = ''; $('#f-arka').value = ''; setFormImg('', null); toast('Kart eklendi.');
    }
    LS.set('fders', ders); LS.set('fkonu', konu);
  } catch (err) { toast(navigator.onLine ? 'Kart kaydedilemedi.' : 'İnternet yok, kart kaydedilemedi.'); }
  btn.disabled = false; btn.textContent = editingId ? 'Kaydet' : 'Kartı ekle';
});

/* ---------- eşitleme ---------- */
function saveCache() { LS.set('cards', cards); }
function refresh(first) {
  cards.sort((a, b) => a.t - b.t); byId = new Map(cards.map(c => [c.id, c])); saveCache();
  renderFilters(); renderManager();
  if (first || !ses.started) start();
  else if (!$('#card') || !current()) renderStage();
  else { const c = current(); if (c) { fillFront(c); const ar = $('#c-arka'); if (ar) ar.textContent = c.arka; } }
}
function setAll(rows, first) {
  cards = rows.map(fromRow);
  for (const c of cards) if (pending[c.id]) Object.assign(c, { durum: pending[c.id].durum, dogru: pending[c.id].dogru, yanlis: pending[c.id].yanlis });
  loaded = true; refresh(first);
}
function upsertLocal(row) {
  const c = fromRow(row); if (pending[c.id]) Object.assign(c, pending[c.id]);
  const old = byId.get(c.id); if (old) Object.assign(old, c); else cards.push(c);
  loaded = true; refresh(false);
}
function removeLocal(id) { cards = cards.filter(c => c.id !== id); refresh(false); }

let loadedOnce = false;
async function load() {
  const all = []; let from = 0;
  while (true) {
    const { data, error } = await sb.from('cards').select('*').order('created_at').range(from, from + 999);
    if (error) { setSync('err', navigator.onLine ? 'Bağlanamadı' : 'Çevrimdışı'); if (!loaded) { loaded = true; renderStage(); } return; }
    all.push(...data); if (data.length < 1000) break; from += 1000;
  }
  setAll(all, !loadedOnce); loadedOnce = true; setSync('on', 'Eşitlendi');
}

// Önce kayıtlı kopyayı göster, sonra sunucudan tazele
const cached = LS.get('cards', null);
if (Array.isArray(cached) && cached.length) { cards = cached; loaded = true; byId = new Map(cards.map(c => [c.id, c])); renderFilters(); renderManager(); start(); }
else { renderFilters(); renderStage(); renderManager(); }
load().then(flushPending);

sb.channel('cards').on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, p => {
  if (p.eventType === 'DELETE') { if (p.old?.id) removeLocal(p.old.id); }
  else if (p.new) upsertLocal(p.new);
}).subscribe(s => { if (s === 'SUBSCRIBED') setSync('on', 'Eşitlendi'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { load(); flushPending(); checkUpdate(false); } });

/* ---------- güncellemeler ---------- */
$('#ver').textContent = 'Sürüm ' + APP_VERSION;
let swReg = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
async function applyUpdate() {
  try { if (swReg) await swReg.update(); const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('nk-shell')).map(k => caches.delete(k))); } catch (e) {}
  location.reload();
}
async function checkUpdate(manual) {
  const btn = $('#check'); if (manual) { btn.disabled = true; btn.textContent = 'Denetleniyor…'; }
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); const v = await r.json();
    if (v.version && v.version !== APP_VERSION) { $('#update').hidden = false; $('#update span').textContent = `Yeni sürüm hazır (${v.version}).`; if (manual) toast('Yeni sürüm bulundu.'); }
    else if (manual) toast('Uygulama güncel.');
  } catch (e) { if (manual) toast('Denetlenemedi, internet bağlantısını kontrol edin.'); }
  if (manual) { btn.disabled = false; btn.textContent = 'Güncellemeleri denetle'; }
}
$('#check').addEventListener('click', () => checkUpdate(true));
$('#update-btn').addEventListener('click', applyUpdate);
checkUpdate(false);
}

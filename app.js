// Not Kartı
const APP_VERSION = '1.1.0';
{
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
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
const pending = LS.get('pending', {});
const sel = { ders: LS.get('ders', ''), konu: LS.get('konu', ''), mod: LS.get('mod', 'hepsi'), kar: LS.get('kar', true), yon: LS.get('yon', 'kt') };
const ses = { queue: [], i: 0, dogru: 0, yanlis: 0, flipped: false, active: false };
const nav = { ders: null, konu: null };

/* ---------- veri ---------- */
const fromRow = r => ({ id: r.id, ders: r.ders || 'Genel', konu: r.konu || 'Genel', on: r.on_yuz || '', arka: r.arka || '',
  resim: r.resim || '', durum: r.durum || 'yeni', dogru: r.dogru || 0, yanlis: r.yanlis || 0, t: Date.parse(r.created_at) || 0 });
const imgOk = p => typeof p === 'string' && /^[A-Za-z0-9._-]{4,120}$/.test(p);
const imgUrl = p => `${CFG.url}/storage/v1/object/public/${CFG.bucket}/${encodeURIComponent(p)}`;
const dersler = () => [...new Set(cards.map(c => c.ders))].sort(cmp);
const konular = d => [...new Set(cards.filter(c => !d || c.ders === d).map(c => c.konu))].sort(cmp);
const inSel = c => (!sel.ders || c.ders === sel.ders) && (!sel.konu || c.konu === sel.konu);
const pool = () => cards.filter(c => inSel(c) && (sel.mod === 'hepsi' || (sel.mod === 'bilmiyorum' ? c.durum === 'bilmiyorum' : c.durum !== 'biliyorum')));
const counts = list => ({ n: list.length, k: list.filter(c => c.durum === 'biliyorum').length, b: list.filter(c => c.durum === 'bilmiyorum').length });
const mini = l => { const c = counts(l); return `<div class="mini"><i class="k" style="width:${c.n ? c.k / c.n * 100 : 0}%"></i><i class="b" style="width:${c.n ? c.b / c.n * 100 : 0}%"></i></div>`; };
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- genel ---------- */
let toastTimer;
function toast(msg, undo) {
  $('#toast-t').textContent = msg; const b = $('#toast-b'); b.hidden = !undo;
  b.onclick = undo ? () => { undo(); hideToast(); } : null;
  $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, undo ? 6000 : 3000);
}
function hideToast() { $('#toast').classList.remove('show'); }
function setSync(state, text) { $$('.sync').forEach(s => { s.classList.remove('on', 'err'); if (state) s.classList.add(state); s.querySelector('span').textContent = text; }); }

function go(view) {
  if (view === 'ekle' && editingId) endEdit();
  document.body.dataset.view = view;
  $$('[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === view));
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

/* ---------- ÇALIŞ: kurulum ---------- */
function renderSetup() {
  const ds = dersler(); if (sel.ders && !ds.includes(sel.ders)) sel.ders = '';
  const ks = konular(sel.ders); if (sel.konu && !ks.includes(sel.konu)) sel.konu = '';
  $('#c-ders').innerHTML = `<button class="chip${!sel.ders ? ' on' : ''}" data-d="">Tümü<small>${cards.length}</small></button>` +
    ds.map(d => `<button class="chip${d === sel.ders ? ' on' : ''}" data-d="${esc(d)}">${esc(d)}<small>${cards.filter(c => c.ders === d).length}</small></button>`).join('');
  $('#c-konu').innerHTML = `<button class="chip${!sel.konu ? ' on' : ''}" data-k="">Tümü</button>` +
    ks.map(k => `<button class="chip${k === sel.konu ? ' on' : ''}" data-k="${esc(k)}">${esc(k)}<small>${cards.filter(c => c.konu === k && (!sel.ders || c.ders === sel.ders)).length}</small></button>`).join('');
  const c = counts(cards.filter(inSel));
  $('#stats').innerHTML = `<div class="stat"><b>${c.n}</b><span>Kart</span></div><div class="stat ok"><b>${c.k}</b><span>Biliyorum</span></div><div class="stat bad"><b>${c.b}</b><span>Bilmiyorum</span></div><div class="stat new"><b>${c.n - c.k - c.b}</b><span>Yeni</span></div>`;
  $$('#s-yon button').forEach(b => b.classList.toggle('on', b.dataset.yon === sel.yon));
  $$('#s-mod button').forEach(b => b.classList.toggle('on', b.dataset.mod === sel.mod));
  $('#s-kar').checked = !!sel.kar;
  const n = loaded ? pool().length : 0, st = $('#start');
  st.disabled = !n;
  st.textContent = !loaded ? 'Kartlar yükleniyor…' : !cards.length ? 'Önce kart ekleyin' : n ? `Başla · ${n} kart` : 'Bu seçimde kart yok';
}
function saveSel() { for (const k of ['ders', 'konu', 'mod', 'kar', 'yon']) LS.set(k, sel[k]); }
$('#c-ders').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; sel.ders = b.dataset.d; sel.konu = ''; saveSel(); renderSetup(); });
$('#c-konu').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; sel.konu = b.dataset.k; saveSel(); renderSetup(); });
$('#s-yon').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; sel.yon = b.dataset.yon; saveSel(); renderSetup(); });
$('#s-mod').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; sel.mod = b.dataset.mod; saveSel(); renderSetup(); });
$('#s-kar').addEventListener('change', e => { sel.kar = e.target.checked; saveSel(); });
$('#start').addEventListener('click', start);

/* ---------- ÇALIŞ: tur ---------- */
function start() {
  const ids = pool().map(c => c.id); if (!ids.length) return;
  Object.assign(ses, { queue: sel.kar ? shuffle(ids) : ids, i: 0, dogru: 0, yanlis: 0, flipped: false, active: true });
  $('#setup').hidden = true; $('#study').hidden = false; document.body.classList.add('studying');
  $('#sb-title').textContent = [sel.ders || 'Tüm dersler', sel.konu].filter(Boolean).join(' · ') + (sel.yon === 'tk' ? ' · Tanım → Kelime' : '');
  window.scrollTo(0, 0); renderStage();
}
function stop() {
  ses.active = false; $('#setup').hidden = false; $('#study').hidden = true; document.body.classList.remove('studying'); renderSetup();
}
$('#exit').addEventListener('click', stop);
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

function faceHTML(c, side) {
  // side: 'front' | 'back'; yon kt: ön=kelime, tk: ön=tanım
  const showTerm = (sel.yon === 'kt') === (side === 'front');
  const where = `${esc(c.ders)} · ${esc(c.konu)}`;
  const pill = side === 'back' ? 'Cevap' : showTerm ? 'Kelime' : 'Tanım';
  return `<div class="ftop"><span class="pill">${pill}</span><span class="where">${where}</span></div><div class="fbody" data-side="${side}"></div>` +
    (side === 'front' ? '<div class="fhint"><svg><use href="#i-cevir"/></svg>Çevirmek için dokunun</div>' : '');
}
function fillFace(el, c, side) {
  const showTerm = (sel.yon === 'kt') === (side === 'front');
  el.textContent = '';
  if (showTerm) {
    const hasImg = imgOk(c.resim);
    if (hasImg) {
      const im = new Image(); im.alt = side === 'front' ? 'Kart resmi' : (c.on || 'Kart resmi'); im.src = imgUrl(c.resim);
      im.onerror = () => im.replaceWith(Object.assign(document.createElement('p'), { className: 'def', textContent: 'Resim yüklenemedi' }));
      el.append(im);
    }
    if (c.on && !(hasImg && side === 'front')) el.append(Object.assign(document.createElement('div'), { className: hasImg ? 'def' : 'term', textContent: c.on }));
  } else el.append(Object.assign(document.createElement('div'), { className: 'def', textContent: c.arka }));
}

function renderStage() {
  const st = $('#stage'), total = ses.queue.length, c = current();
  const done = Math.min(ses.i, total);
  $('#sb-bar').style.width = (total ? done / total * 100 : 0).toFixed(1) + '%';
  $('#sb-count').textContent = c ? `${done + 1} / ${total}` : `${total} / ${total}`;
  if (!c) {
    const anyWrong = cards.some(x => inSel(x) && x.durum === 'bilmiyorum');
    st.innerHTML = `<div class="panel done"><h2>Tur bitti</h2><p class="muted">Bu turdaki cevaplarınız</p>
      <div class="sum"><div class="s-ok"><b>${ses.dogru}</b>Biliyorum</div><div class="s-bad"><b>${ses.yanlis}</b>Bilmiyorum</div></div>
      <div class="row"><button class="btn pri" id="again">Yeniden çalış</button>${anyWrong ? '<button class="btn" id="wrong">Bilmediklerimi çalış</button>' : ''}<button class="btn ghost" id="finish">Bitir</button></div></div>`;
    return;
  }
  st.innerHTML = `<div class="scene"><div class="card3d${ses.flipped ? ' flipped' : ''}" id="card" role="button" tabindex="0" aria-label="Kartı çevir">
    <div class="face front">${faceHTML(c, 'front')}</div><div class="face back">${faceHTML(c, 'back')}</div></div></div>
    <div class="acts" id="acts"></div><p class="kbd">Boşluk: çevir · ←: bilmiyorum · →: biliyorum</p>`;
  fillFace($('[data-side=front]'), c, 'front'); fillFace($('[data-side=back]'), c, 'back');
  renderActs();
}
function renderActs() {
  const a = $('#acts'); if (!a) return;
  a.innerHTML = ses.flipped ? '<button class="btn no" data-ans="0">Bilmiyorum</button><button class="btn yes" data-ans="1">Biliyorum</button>'
    : '<button class="btn pri full" id="flipb">Cevabı göster</button>';
}
$('#stage').addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#card') || t.closest('#flipb')) return flip();
  const ans = t.closest('[data-ans]'); if (ans) return answer(ans.dataset.ans === '1');
  if (t.closest('#again')) return start();
  if (t.closest('#wrong')) { sel.mod = 'bilmiyorum'; saveSel(); return start(); }
  if (t.closest('#finish')) return stop();
});
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select') || !ses.active || document.body.dataset.view !== 'calis' || !$('#card')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
  else if (e.key === 'ArrowLeft' && ses.flipped) answer(false);
  else if (e.key === 'ArrowRight' && ses.flipped) answer(true);
  else if (e.key === 'Escape') stop();
});

/* ---------- KARTLAR ---------- */
function cardRow(c) {
  return `<div class="lrow"><i class="dot ${esc(c.durum)}"></i>${imgOk(c.resim) ? `<img class="thumb" alt="" loading="lazy" src="${esc(imgUrl(c.resim))}">` : ''}
    <div class="t"><b>${esc(c.on || 'Resimli kart')}</b><p>${esc(c.arka)}</p></div>
    <div class="rowacts"><button data-edit="${esc(c.id)}">Düzenle</button><button class="del" data-del="${esc(c.id)}">Sil</button></div></div>`;
}
function renderBrowse() {
  const q = $('#q').value.trim().toLocaleLowerCase('tr'), box = $('#browse');
  $('#total').textContent = cards.length;
  if (nav.ders && !cards.some(c => c.ders === nav.ders)) { nav.ders = null; nav.konu = null; }
  if (nav.konu && !cards.some(c => c.ders === nav.ders && c.konu === nav.konu)) nav.konu = null;
  $('#b-back').hidden = !nav.ders || !!q;
  $('#b-title').textContent = q ? 'Arama' : nav.konu || nav.ders || 'Kartlar';
  if (!loaded) { box.innerHTML = '<div class="panel empty"><h2>Kartlar yükleniyor…</h2></div>'; return; }
  if (!cards.length) { box.innerHTML = '<div class="panel empty"><h2>Henüz kart yok</h2><p>İlk kartınızı ekleyin. Ders ve konu adını yazmanız yeterli, klasörler kendiliğinden oluşur.</p><button class="btn pri" data-go="ekle">Kart ekle</button></div>'; return; }
  if (q) {
    const list = cards.filter(c => (c.on + ' ' + c.arka + ' ' + c.ders + ' ' + c.konu).toLocaleLowerCase('tr').includes(q));
    box.innerHTML = list.length ? `<div class="sectitle">${list.length} sonuç</div><div class="panel lpanel">${list.map(cardRow).join('')}</div>` : '<div class="panel empty"><h2>Sonuç yok</h2><p>Başka bir kelimeyle arayın.</p></div>';
    return;
  }
  if (!nav.ders) {
    box.innerHTML = `<div class="dgrid">${dersler().map(d => { const l = cards.filter(c => c.ders === d), k = konular(d).length;
      return `<button class="dcard" data-bd="${esc(d)}"><b>${esc(d)}</b><small>${k} konu · ${l.length} kart</small>${mini(l)}</button>`; }).join('')}</div>`;
    return;
  }
  if (!nav.konu) {
    box.innerHTML = `<div class="panel lpanel">${konular(nav.ders).map(k => { const l = cards.filter(c => c.ders === nav.ders && c.konu === k);
      return `<button class="lrow" data-bk="${esc(k)}"><div class="t"><b>${esc(k)}</b><small>${l.length} kart</small></div>${mini(l)}<svg><use href="#i-ok"/></svg></button>`; }).join('')}</div>`;
    return;
  }
  const list = cards.filter(c => c.ders === nav.ders && c.konu === nav.konu);
  box.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="btn pri sm" id="studyhere">Bu konuyu çalış</button><button class="btn sm" id="addhere">Bu konuya kart ekle</button></div><div class="panel lpanel">${list.map(cardRow).join('')}</div>`;
}
$('#q').addEventListener('input', renderBrowse);
$('#b-back').addEventListener('click', () => { if (nav.konu) nav.konu = null; else nav.ders = null; renderBrowse(); window.scrollTo(0, 0); });
$('#browse').addEventListener('click', async e => {
  const t = e.target;
  const bd = t.closest('[data-bd]'); if (bd) { nav.ders = bd.dataset.bd; renderBrowse(); window.scrollTo(0, 0); return; }
  const bk = t.closest('[data-bk]'); if (bk) { nav.konu = bk.dataset.bk; renderBrowse(); window.scrollTo(0, 0); return; }
  if (t.closest('#studyhere')) { sel.ders = nav.ders; sel.konu = nav.konu; sel.mod = 'hepsi'; saveSel(); go('calis'); renderSetup(); return start(); }
  if (t.closest('#addhere')) { go('ekle'); $('#f-ders').value = nav.ders; $('#f-konu').value = nav.konu; $('#f-on').focus(); return; }
  const ed = t.closest('[data-edit]'); if (ed) return beginEdit(ed.dataset.edit);
  const del = t.closest('[data-del]');
  if (del) {
    if (!del.dataset.c) { del.dataset.c = 1; del.textContent = 'Emin misiniz?'; setTimeout(() => { if (del.isConnected) { delete del.dataset.c; del.textContent = 'Sil'; } }, 3000); return; }
    const c = byId.get(del.dataset.del); if (!c) return;
    const { error } = await sb.from('cards').delete().eq('id', c.id);
    if (error) { toast('Kart silinemedi, internet bağlantısını kontrol edin.'); return; }
    lastDeleted = c; removeLocal(c.id);
    toast('Kart silindi.', async () => {
      const d = lastDeleted;
      const { data, error: err } = await sb.from('cards').insert({ id: d.id, ders: d.ders, konu: d.konu, on_yuz: d.on, arka: d.arka, resim: d.resim || null, durum: d.durum, dogru: d.dogru, yanlis: d.yanlis }).select().single();
      if (err) toast('Geri alınamadı.'); else upsertLocal(data);
    });
  }
});

/* ---------- EKLE / DÜZENLE ---------- */
function fillLists() {
  $('#dl-ders').innerHTML = dersler().map(d => `<option value="${esc(d)}">`).join('');
  $('#dl-konu').innerHTML = konular($('#f-ders').value.trim()).map(k => `<option value="${esc(k)}">`).join('');
}
$('#f-ders').addEventListener('input', fillLists);
$('#f-ders').value = LS.get('fders', ''); $('#f-konu').value = LS.get('fkonu', '');

function setFormImg(path, file) {
  formImg = path || ''; pendingFile = file || null; const p = $('#f-prev');
  if (p.src.startsWith('blob:')) URL.revokeObjectURL(p.src);
  if (file) p.src = URL.createObjectURL(file); else if (imgOk(formImg)) p.src = imgUrl(formImg); else p.removeAttribute('src');
  $('#f-prevbox').hidden = !(file || imgOk(formImg));
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

function beginEdit(id) {
  const c = byId.get(id); if (!c) return;
  go('ekle'); editingId = c.id;
  $('#f-ders').value = c.ders; $('#f-konu').value = c.konu; $('#f-on').value = c.on; $('#f-arka').value = c.arka; setFormImg(c.resim, null);
  $('#f-title').textContent = 'Kartı düzenle'; $('#f-save').textContent = 'Değişiklikleri kaydet'; $('#f-cancel').hidden = false; $('#f-back').hidden = false;
}
function endEdit() {
  editingId = null; $('#f-title').textContent = 'Kart ekle'; $('#f-save').textContent = 'Kartı ekle'; $('#f-cancel').hidden = true; $('#f-back').hidden = true;
  $('#f-on').value = ''; $('#f-arka').value = ''; setFormImg('', null);
}
const leaveEdit = () => { endEdit(); go('kartlar'); };
$('#f-cancel').addEventListener('click', leaveEdit);
$('#f-back').addEventListener('click', leaveEdit);

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const ders = $('#f-ders').value.trim(), konu = $('#f-konu').value.trim() || 'Genel', on = $('#f-on').value.trim(), arka = $('#f-arka').value.trim();
  if (!ders || !arka) return;
  if (!on && !pendingFile && !formImg) { toast('Kavram yazın ya da resim ekleyin.'); $('#f-on').focus(); return; }
  const btn = $('#f-save'), label = btn.textContent; btn.disabled = true;
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
      if (error) throw error; upsertLocal(data); toast('Kart güncellendi.'); btn.disabled = false; leaveEdit(); return;
    }
    const { data, error } = await sb.from('cards').insert(row).select().single();
    if (error) throw error; upsertLocal(data);
    $('#f-on').value = ''; $('#f-arka').value = ''; setFormImg('', null); $('#f-on').focus(); toast('Kart eklendi.');
    LS.set('fders', ders); LS.set('fkonu', konu);
  } catch (err) { toast(navigator.onLine ? 'Kart kaydedilemedi.' : 'İnternet yok, kart kaydedilemedi.'); }
  btn.disabled = false; btn.textContent = label;
});

/* ---------- AYARLAR ---------- */
$('#ver').textContent = APP_VERSION;
$('#resetall').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!b.dataset.c) { b.dataset.c = 1; b.textContent = 'Emin misiniz? Tekrar dokunun'; setTimeout(() => { delete b.dataset.c; b.textContent = 'Tüm ilerlemeyi sıfırla'; }, 4000); return; }
  b.disabled = true;
  const ids = cards.filter(c => c.durum !== 'yeni').map(c => c.id);
  const { error } = ids.length ? await sb.from('cards').update({ durum: 'yeni', dogru: 0, yanlis: 0, updated_at: new Date().toISOString() }).in('id', ids) : { error: null };
  b.disabled = false; delete b.dataset.c; b.textContent = 'Tüm ilerlemeyi sıfırla';
  if (error) return toast('Sıfırlanamadı, internet bağlantısını kontrol edin.');
  ids.forEach(id => Object.assign(byId.get(id), { durum: 'yeni', dogru: 0, yanlis: 0 })); refresh(); toast('İlerleme sıfırlandı.');
});

/* ---------- eşitleme ---------- */
function saveCache() { LS.set('cards', cards); }
function refresh() {
  cards.sort((a, b) => a.t - b.t); byId = new Map(cards.map(c => [c.id, c])); saveCache();
  renderSetup(); renderBrowse(); fillLists();
  if (ses.active) {
    const c = current(), f = $('[data-side=front]');
    if (!c || !f) renderStage(); else { fillFace(f, c, 'front'); fillFace($('[data-side=back]'), c, 'back'); }
  }
}
function setAll(rows) {
  cards = rows.map(fromRow);
  for (const c of cards) if (pending[c.id]) Object.assign(c, { durum: pending[c.id].durum, dogru: pending[c.id].dogru, yanlis: pending[c.id].yanlis });
  loaded = true; refresh();
}
function upsertLocal(row) {
  const c = fromRow(row); if (pending[c.id]) Object.assign(c, { durum: pending[c.id].durum, dogru: pending[c.id].dogru, yanlis: pending[c.id].yanlis });
  const old = byId.get(c.id); if (old) Object.assign(old, c); else cards.push(c);
  loaded = true; refresh();
}
function removeLocal(id) { cards = cards.filter(c => c.id !== id); refresh(); }

async function load() {
  const all = []; let from = 0;
  while (true) {
    const { data, error } = await sb.from('cards').select('*').order('created_at').range(from, from + 999);
    if (error) { setSync('err', navigator.onLine ? 'Bağlanamadı' : 'Çevrimdışı'); if (!loaded) { loaded = true; refresh(); } return; }
    all.push(...data); if (data.length < 1000) break; from += 1000;
  }
  setAll(all); setSync('on', 'Eşitlendi');
}

const cached = LS.get('cards', null);
if (Array.isArray(cached) && cached.length) { cards = cached; loaded = true; }
go('calis'); refresh();
load().then(flushPending);

sb.channel('cards').on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, p => {
  if (p.eventType === 'DELETE') { if (p.old?.id && byId.has(p.old.id)) removeLocal(p.old.id); }
  else if (p.new) upsertLocal(p.new);
}).subscribe(s => { if (s === 'SUBSCRIBED') setSync('on', 'Eşitlendi'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { load(); flushPending(); checkUpdate(false); } });

/* ---------- güncellemeler ---------- */
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

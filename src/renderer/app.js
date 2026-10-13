const $ = (s) => document.querySelector(s);
const { LAYOUTS, LIVE_SHORTCUTS, MODIFIERS, keyIdFromEvent, keyLabel } = window.Keyboard;
// A mapping is a plugin id, or { id, newTrack } when the plugin should go onto a new track.
const mapVal = (v) => (v == null ? null : typeof v === 'string' ? { id: v, newTrack: false } : v);

const state = {
  library: [],
  settings: null,
  supportedFormats: [],
  query: '',
  type: 'All', // All | Effect | Instrument | MIDI FX
  source: 'All', // All | Plugin | Stock | Max | Preset (presets only on their own tab – there are thousands)
  formats: null, // Set of enabled plugin formats
  view: 'grid', // categories | vendors | grid – starts in the grid
  category: null,
  sub: null,
  vendor: null,
  vendorQuery: '',
  vendorsAll: false,
  collection: null, // id of the selected own collection
  selected: new Set(), // ⌘-click multi-selection (item ids)
  showHidden: false,
  sort: 'name',
  expanded: new Set(), // categories open in the sidebar tree
  assigning: null, // item id waiting for a key press
  shots: {}, // name|vendor → screenshot path or 'failed'
};
const groupKey = (p) => `${p.name.toLowerCase()}|${p.vendor.toLowerCase()}`;
// Picture of this plugin – or of the same plugin in another format/spelling (VST2 "… (Mono)", vendor variants).
let looseIdx = null;
let looseFor = null;
const shotFor = (it) => {
  const v = state.shots[groupKey(it)];
  if (v && v !== 'failed') return v;
  if (looseFor !== state.shots) { looseIdx = window.ShotKey.buildIndex(state.shots); looseFor = state.shots; }
  return looseIdx.get(window.ShotKey.looseKey(it.name, it.vendor))
    // A device preset looks like its device: use the stock device's picture.
    || (it.source === 'Preset' && it.device && !v ? shotFor({ name: it.device, vendor: 'Ableton' }) : null);
};

const TYPE_LABELS = { All: 'Alle', Effect: 'Effekte', Instrument: 'Instrumente', 'MIDI FX': 'MIDI FX' };
const SOURCE_LABELS = { All: 'Alle', Plugin: 'Plugins', Stock: 'Stock', Max: 'Max', Preset: 'Presets' };
const CAT_ICONS = {
  Dynamics: '◧', EQ: '≋', Reverb: '◠', Delay: '⋯', Drive: '▲', Modulation: '∿', Filter: '▽', Pitch: '♪', Spatial: '◉',
  Utility: '⚙', 'Channel Strip': '▥', 'Multi FX': '✣', Unsorted: '◌', Synth: '〰', Sampler: '▤', Drums: '◍', Bass: '♫',
  Keys: '▦', Orchestral: '♬', Guitar: '♪', Arpeggiator: '⇡', Chord: '♯', Sequencer: '▸', Generator: '✦', 'Note Tools': '♩', Controller: '⌘',
};

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const imgUrl = (p) => `pimg://img/?p=${encodeURIComponent(p)}`;
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function initials(name) { return name.split(/[\s\-_]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${err ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function save(patch) {
  state.settings = await window.api.saveSettings(patch);
}

// Items = plugins, optionally merged across formats (same name + vendor).
function items() {
  const { settings } = state;
  const hidden = new Set(settings.hidden);
  let list = state.library.filter((p) => (state.showHidden ? hidden.has(p.id) : !hidden.has(p.id)));
  list = list.filter((p) => p.source !== 'Plugin' || state.formats.has(p.format));
  list = list.map((p) => {
    const o = settings.categoryOverrides[p.id];
    if (!o) return p;
    return typeof o === 'string' ? { ...p, category: o, sub: o } : { ...p, ...o };
  });
  if (!$('#groupFormats').checked) return list.map((p) => ({ ...p, formats: [p.format], ids: [p.id] }));
  const map = new Map();
  for (const p of list) {
    const k = groupKey(p);
    const g = map.get(k);
    if (g) { if (!g.formats.includes(p.format)) g.formats.push(p.format); g.ids.push(p.id); if (!g.icon && p.icon) g.icon = p.icon; }
    else map.set(k, { ...p, formats: [p.format], ids: [p.id] });
  }
  return [...map.values()];
}

const keyFor = (it) => Object.entries(state.settings.mappings).find(([, v]) => it.ids.includes(mapVal(v).id))?.[0];
const isFav = (it) => it.ids.some((id) => state.settings.favorites.includes(id));
// "Neu": showed up in a scan within the last 14 days.
const NEW_DAYS = 14;
const isNew = (it) => it.ids.some((id) => (state.settings.firstSeen?.[id] || 0) > Date.now() - NEW_DAYS * 86400000);
const customImg = (it) => it.ids.map((id) => state.settings.images[id]).find(Boolean);

function matches(it) {
  if (!state.query) return true;
  const hay = `${it.name} ${it.vendor} ${it.category} ${it.sub} ${it.type} ${it.formats.join(' ')}`.toLowerCase();
  return state.query.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

// ---------- render ----------
const count = (list, f) => list.reduce((acc, it) => { const v = f(it); acc[v] = (acc[v] || 0) + 1; return acc; }, {});
const sortCounts = (c) => Object.entries(c).sort((a, b) => (a[0] === 'Unsorted') - (b[0] === 'Unsorted') || a[0].localeCompare(b[0]));

function renderSegments(el, options, active, labels, onPick, counts) {
  el.innerHTML = options.map((o) => `<button class="${o === active ? 'active' : ''}" data-v="${esc(o)}">${esc(labels[o] || o)}${counts ? ` <small>${counts[o] || 0}</small>` : ''}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => { b.onclick = () => onPick(b.dataset.v); });
}

function renderFilterBar(all) {
  const typeCounts = { ...count(all, (i) => i.type), All: all.length };
  renderSegments($('#typeTabs'), ['All', 'Effect', 'Instrument', 'MIDI FX'], state.type, TYPE_LABELS, (v) => {
    state.type = v; state.category = null; state.sub = null; render();
  }, typeCounts);
  renderSegments($('#sourceTabs'), ['All', 'Plugin', 'Stock', 'Max', 'Preset'], state.source, SOURCE_LABELS, (v) => { state.source = v; render(); });
  const fmts = state.supportedFormats.filter((f) => !['Stock', 'Max'].includes(f));
  $('#formatChips').innerHTML = fmts.map((f) => `<button class="chipbtn ${state.formats.has(f) ? 'on' : ''}" data-f="${f}">${f}</button>`).join('');
  $('#formatChips').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const f = b.dataset.f;
      if (state.formats.has(f)) { if (state.formats.size > 1) state.formats.delete(f); } else state.formats.add(f);
      render();
    };
  });
  renderSegments($('#viewTabs'), ['categories', 'vendors', 'grid'], state.view, { categories: '▦ Kategorien', vendors: '▦ Hersteller', grid: '▤ Raster' }, (v) => {
    state.view = v;
    if (v === 'categories') { state.category = null; state.sub = null; }
    if (v === 'vendors') state.vendor = null;
    render();
  });
}

function renderTree(list) {
  const el = $('#categories');
  const cats = count(list, (i) => i.category);
  el.innerHTML = '';
  for (const [cat, n] of sortCounts(cats)) {
    const subs = count(list.filter((i) => i.category === cat), (i) => i.sub);
    const hasSubs = Object.keys(subs).length > 1;
    const open = state.expanded.has(cat) || state.category === cat;
    const li = document.createElement('li');
    li.className = `cat${state.category === cat && !state.sub ? ' active' : ''}`;
    li.innerHTML = `<span><i class="ci">${CAT_ICONS[cat] || '•'}</i>${esc(cat)}${hasSubs ? `<b class="tw">${open ? '▾' : '▸'}</b>` : ''}</span><span>${n}</span>`;
    li.onclick = (e) => {
      if (e.target.classList.contains('tw')) { state.expanded.has(cat) ? state.expanded.delete(cat) : state.expanded.add(cat); render(); return; }
      if (state.category === cat && !state.sub) { state.category = null; } else { state.category = cat; state.sub = null; state.expanded.add(cat); }
      render();
    };
    el.appendChild(li);
    if (hasSubs && open) {
      for (const [sub, m] of Object.entries(subs).sort((a, b) => b[1] - a[1])) {
        const sl = document.createElement('li');
        sl.className = `sub${state.category === cat && state.sub === sub ? ' active' : ''}`;
        sl.innerHTML = `<span>${esc(sub)}</span><span>${m}</span>`;
        sl.onclick = () => {
          if (state.category === cat && state.sub === sub) state.sub = null; else { state.category = cat; state.sub = sub; }
          render();
        };
        el.appendChild(sl);
      }
    }
  }
}

// ---------- own collections ----------
const COLL_COLORS = ['#e8a33d', '#e5484d', '#3ecf8e', '#4aa3ff', '#b57bff', '#ff7ac6', '#8b90a0'];
const collections = () => state.settings.collections || [];
const inColl = (it, c) => it.ids.some((id) => c.ids.includes(id));

async function saveCollections(list) { await save({ collections: list }); render(); }

function renderCollections(list) {
  const el = $('#collections');
  el.innerHTML = '';
  const sorted = [...collections()].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  for (const c of sorted) {
    const n = list.filter((it) => inColl(it, c)).length;
    const li = document.createElement('li');
    li.className = state.collection === c.id ? 'active' : '';
    li.innerHTML = `<span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span><span>${n}${c.pinned ? '<i class="pin">📌</i>' : ''}</span>`;
    li.onclick = () => { state.collection = state.collection === c.id ? null : c.id; if (state.collection) state.view = 'grid'; render(); };
    li.oncontextmenu = (e) => { e.preventDefault(); showCollMenu(e, c); };
    // Drop a card onto a collection to add it.
    li.ondragover = (e) => { e.preventDefault(); li.classList.add('dropok'); };
    li.ondragleave = () => li.classList.remove('dropok');
    li.ondrop = (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const it = items().find((x) => x.ids.includes(id));
      if (!it) return;
      saveCollections(collections().map((x) => (x.id === c.id ? { ...x, ids: [...new Set([...x.ids, ...it.ids])] } : x)));
      toast(`${it.name} → ${c.name}`);
    };
    el.appendChild(li);
  }
}

// Inline name input (Electron has no prompt()).
function nameInput(host, initial, onDone) {
  host.innerHTML = `<input value="${esc(initial)}" placeholder="Name …">`;
  const inp = host.querySelector('input');
  inp.focus();
  inp.select();
  let done = false;
  const finish = (ok) => { if (done) return; done = true; onDone(ok ? inp.value.trim() : ''); };
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
}

function newCollection(withItem) {
  const host = $('#newColl');
  nameInput(host, '', async (name) => {
    host.textContent = '+ Neu';
    if (!name) return;
    const c = { id: `c${Date.now()}`, name, color: COLL_COLORS[collections().length % COLL_COLORS.length], pinned: false, ids: withItem ? [...withItem.ids] : [] };
    await saveCollections([...collections(), c]);
    toast(withItem ? `${withItem.name} → ${name}` : `Sammlung „${name}“ angelegt – Karten hierher ziehen`);
  });
}

function showCollMenu(e, c) {
  const m = $('#menu');
  m.innerHTML = `
    <div class="msub">${esc(c.name)}</div>
    <div data-a="rename">Umbenennen</div>
    <div data-a="pin">${c.pinned ? 'Lösen' : 'Anheften'}</div>
    <div class="swatches">${COLL_COLORS.map((col) => `<span data-color="${col}" style="background:${col}"></span>`).join('')}</div>
    <hr>
    <div data-a="delete">Sammlung löschen</div>`;
  m.classList.remove('hidden');
  m.style.left = `${Math.min(e.clientX, innerWidth - 220)}px`;
  m.style.top = `${Math.min(e.clientY, innerHeight - m.offsetHeight - 10)}px`;
  m.onclick = async (ev) => {
    const color = ev.target.dataset.color;
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (!a && !color) return;
    m.classList.add('hidden');
    const update = (patch) => saveCollections(collections().map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    if (color) update({ color });
    if (a === 'pin') update({ pinned: !c.pinned });
    if (a === 'delete') { if (state.collection === c.id) state.collection = null; saveCollections(collections().filter((x) => x.id !== c.id)); toast(`„${c.name}“ gelöscht – die Plugins bleiben erhalten`); }
    if (a === 'rename') {
      const li = [...$('#collections').children].find((x) => x.textContent.startsWith(c.name));
      if (li) nameInput(li, c.name, (name) => (name ? update({ name }) : render()));
    }
  };
}

$('#newColl').onclick = (e) => { if (e.target.tagName !== 'INPUT') newCollection(); };

function renderVendors(list) {
  const el = $('#vendors');
  const vq = state.vendorQuery.toLowerCase();
  const entries = Object.entries(count(list, (i) => i.vendor))
    .filter(([v]) => v.toLowerCase().includes(vq))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  el.innerHTML = '';
  const limit = state.vendorsAll || vq ? entries.length : 10;
  const visible = entries.slice(0, limit);
  if (state.vendor && !visible.some(([v]) => v === state.vendor)) visible.push(entries.find(([v]) => v === state.vendor) || [state.vendor, 0]);
  const more = $('#vendorsMore');
  more.textContent = entries.length > 10 && !vq ? (state.vendorsAll ? 'Weniger zeigen' : `Alle ${entries.length} zeigen →`) : '';
  more.onclick = () => { state.vendorsAll = !state.vendorsAll; render(); };
  for (const [v, n] of visible) {
    const li = document.createElement('li');
    li.className = v === state.vendor ? 'active' : '';
    li.innerHTML = `<span>${esc(v)}</span><span>${n}</span>`;
    li.onclick = () => { state.vendor = v === state.vendor ? null : v; render(); };
    el.appendChild(li);
  }
}

// Overview: one tile per category (or vendor) with a stack of plugin pictures.
function renderCategoryTiles(list, by = 'category') {
  const grid = $('#grid');
  grid.className = 'cattiles';
  grid.innerHTML = '';
  const groups = by === 'vendor'
    ? Object.entries(count(list, (i) => i.vendor)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : sortCounts(count(list, (i) => i.category));
  for (const [cat, n] of groups) {
    const inCat = list.filter((i) => i[by] === cat);
    // Varied pictures: different vendors first, never two variants (m)/(s) of the same plugin.
    const pics = [];
    const seenName = new Set();
    const seenVendor = new Set();
    for (const pass of [0, 1]) {
      for (const i of inCat) {
        const pic = customImg(i) || shotFor(i);
        const base = i.name.replace(/\s*\(.*\)\s*$/, '').toLowerCase();
        if (!pic || seenName.has(base) || (pass === 0 && by === 'category' && seenVendor.has(i.vendor)) || pics.length >= 3) continue;
        pics.push(pic); seenName.add(base); seenVendor.add(i.vendor);
      }
    }
    const el = document.createElement('div');
    el.className = 'cattile';
    const icon = by === 'vendor' ? '' : `<i class="ci">${CAT_ICONS[cat] || '•'}</i>`;
    el.innerHTML = `<div class="cthead"><span>${icon}${esc(cat)}</span><span>${n}</span></div>
      <div class="stack">${pics.length ? pics.map((p, k) => `<img loading="lazy" style="--k:${k}" src="${imgUrl(p)}">`).join('') : `<div class="empty">${esc(initials(cat))}</div>`}</div>`;
    el.onclick = () => {
      if (by === 'vendor') state.vendor = cat;
      else { state.category = cat; state.sub = null; state.expanded.add(cat); }
      state.view = 'grid';
      render();
    };
    grid.appendChild(el);
  }
}

function render() {
  if (sharedIcons.libRef !== state.library) { computeSharedIcons(); sharedIcons.libRef = state.library; }
  if (!state.formats) state.formats = new Set(state.supportedFormats);
  const all = items().filter(matches).filter((it) =>
    (state.source === 'All' ? it.source !== 'Preset' : it.source === state.source)
    && (!$('#onlyFavorites').checked || isFav(it)) && (!$('#onlyMapped').checked || keyFor(it)) && (!$('#onlyNew').checked || isNew(it)));
  const nNew = items().filter(isNew).length;
  $('#newCount').textContent = nNew ? nNew : '';
  renderFilterBar(all);

  renderCollections(all);
  const coll = collections().find((c) => c.id === state.collection);
  const ofType = (state.type === 'All' ? all : all.filter((i) => i.type === state.type)).filter((i) => !coll || inColl(i, coll));
  const byVendor = (it) => !state.vendor || it.vendor === state.vendor;
  const byCat = (it) => (!state.category || it.category === state.category) && (!state.sub || it.sub === state.sub);
  renderTree(ofType.filter(byVendor));
  renderVendors(ofType.filter(byCat));

  const shown = ofType.filter((i) => byCat(i) && byVendor(i));
  const s = state.sort;
  shown.sort((a, b) => (s === 'name' ? 0 : String(a[s]).localeCompare(String(b[s]))) || a.name.localeCompare(b.name));

  const crumbs = [state.showHidden ? 'Ausgeblendete' : null, coll?.name, TYPE_LABELS[state.type], state.category, state.sub, state.vendor].filter(Boolean).join(' › ');
  $('#status').textContent = state.library.length
    ? `${crumbs} · ${shown.length} ${state.assigning ? ' – drücke jetzt eine Taste zum Belegen (Esc = Abbrechen)' : ''}`
    : 'Scanne Plugins …';

  state.lastShown = shown;
  if (state.windowMode === 'sidecar' || state.windowMode === 'mini') {
    renderSide(shown);
    return;
  }
  if (state.view === 'categories' && !state.category && !state.query && !state.showHidden) {
    renderCategoryTiles(shown);
  } else if (state.view === 'vendors' && !state.vendor && !state.query) {
    renderCategoryTiles(shown, 'vendor');
  } else {
    const grid = $('#grid');
    grid.className = 'grid';
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const it of shown) frag.appendChild(card(it));
    grid.appendChild(frag);
  }
  renderKeyboard();
}

// Icons shared by many plugins (e.g. WaveShell) say nothing, so those fall back to initials.
let sharedIcons = new Set();
function computeSharedIcons() {
  const n = {};
  for (const p of state.library) if (p.icon) n[p.icon] = (n[p.icon] || 0) + 1;
  sharedIcons = new Set(Object.keys(n).filter((k) => n[k] > 4));
}

function card(it) {
  const el = document.createElement('div');
  el.className = `card${state.assigning === it.id ? ' assigning' : ''}`;
  el.draggable = true;
  const custom = customImg(it);
  const shot = shotFor(it);
  const key = keyFor(it);
  const h = hue(it.vendor);
  const thumb = custom
    ? `<img class="custom" loading="lazy" src="${imgUrl(custom)}">`
    : shot
    ? `<img class="shot" loading="lazy" src="${imgUrl(shot)}">`
    : it.icon && !sharedIcons.has(it.icon)
      ? `<img loading="lazy" src="${imgUrl(it.icon)}">`
      : esc(initials(it.name));
  el.innerHTML = `
    <div class="thumb" style="background:linear-gradient(135deg,hsl(${h} 45% 32%),hsl(${(h + 40) % 360} 50% 20%))">${thumb}</div>
    ${key ? `<div class="keytag">${mapVal(state.settings.mappings[key]).newTrack ? '＋' : ''}${esc(keyLabel(key))}</div>` : ''}
    ${isFav(it) ? '<div class="fav">★</div>' : ''}
    ${isNew(it) ? '<div class="newtag">NEU</div>' : ''}
    <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
    <div class="vendor">${esc(it.vendor)}</div>
    <div class="badges"><span class="badge cat">${esc(it.sub && it.sub !== it.category ? it.sub : it.category)}</span>${it.formats.map((f) => `<span class="badge">${f}</span>`).join('')}</div>`;
  const img = el.querySelector('.thumb img');
  if (img) img.onerror = () => img.replaceWith(document.createTextNode(initials(it.name)));
  if (custom || shot) {
    const th = el.querySelector('.thumb');
    th.onmouseenter = (e) => showPreview(e, custom || shot);
    th.onmousemove = movePreview;
    th.onmouseleave = hidePreview;
  }
  if (state.selected.has(it.id)) el.classList.add('selected');
  const trash = document.createElement('button');
  trash.className = 'trash';
  trash.title = state.showHidden ? 'Wieder in die Bibliothek aufnehmen' : 'Aus Bibliothek entfernen – bleibt installiert';
  trash.textContent = state.showHidden ? '↺' : '🗑';
  trash.onclick = async (e) => {
    e.stopPropagation();
    if (state.showHidden) { await save({ hidden: state.settings.hidden.filter((id) => !it.ids.includes(id)) }); toast(`${it.name} wieder in der Bibliothek`); render(); }
    else hidePlugins([it]);
  };
  el.appendChild(trash);
  el.onclick = (e) => {
    if (e.metaKey || e.ctrlKey) {
      state.selected.has(it.id) ? state.selected.delete(it.id) : state.selected.add(it.id);
      el.classList.toggle('selected');
      $('#status').dataset.sel = state.selected.size;
      return;
    }
    if (state.selected.size) { state.selected.clear(); render(); return; }
    load(it, { newTrack: e.shiftKey });
  };
  el.oncontextmenu = (e) => { e.preventDefault(); showMenu(e, it); };
  el.ondragstart = (e) => e.dataTransfer.setData('text/plain', it.id);
  return el;
}

function renderKeyboard() {
  const kb = $('#keyboard');
  const st = state.settings;
  const layout = LAYOUTS[st.keyboardLayout] || LAYOUTS.full;
  const byId = new Map(state.library.map((p) => [p.id, p]));
  kb.innerHTML = '';
  for (const block of layout.blocks) {
    const b = document.createElement('div');
    b.className = 'kblock';
    for (const row of block) {
      const r = document.createElement('div');
      r.className = 'krow';
      for (const k of row) {
        const el = document.createElement('div');
        el.style.setProperty('--w', k.w);
        if (k.gap) { el.className = 'key gap'; r.appendChild(el); continue; }
        if (!k.id) { el.className = 'key off'; el.innerHTML = `<b>${esc(k.label)}</b>`; r.appendChild(el); continue; }
        const m = mapVal(st.mappings[k.id]);
        const p = m && byId.get(m.id);
        const live = st.showDawShortcuts && LIVE_SHORTCUTS[k.id];
        el.className = `key${p ? ' mapped' : ''}${live ? ' hasLive' : ''}`;
        el.title = p ? `${p.name}${m.newTrack ? ' (auf neuer Spur)' : ''} – Klick lädt, Rechtsklick für Optionen` : `Plugin hierher ziehen${live ? ` · in Live: ${live}` : ''}`;
        el.innerHTML = `<b>${esc(k.label)}</b>${m?.newTrack ? '<span class="nt">＋</span>' : ''}<span class="kp">${p ? esc(p.name) : ''}</span>${live ? `<span class="live">${esc(live)}</span>` : ''}`;
        el.ondragover = (e) => { e.preventDefault(); el.classList.add('drop'); };
        el.ondragleave = () => el.classList.remove('drop');
        el.ondrop = (e) => { e.preventDefault(); assign(k.id, e.dataTransfer.getData('text/plain')); };
        el.onclick = () => (p ? load({ id: p.id, name: p.name }, { newTrack: m.newTrack }) : state.assigning && assign(k.id, state.assigning));
        el.oncontextmenu = (e) => { e.preventDefault(); if (p) showKeyMenu(e, k.id, m, p); };
        r.appendChild(el);
      }
      b.appendChild(r);
    }
    kb.appendChild(b);
  }
  // Controls
  const ls = $('#kbLayout');
  if (!ls.options.length) ls.innerHTML = Object.entries(LAYOUTS).map(([v, l]) => `<option value="${v}">${esc(l.label)}</option>`).join('');
  ls.value = st.keyboardLayout || 'full';
  const ms = $('#kbModifier');
  if (!ms.options.length) ms.innerHTML = MODIFIERS.map((m) => `<option value="${m.value}">${m.label}</option>`).join('');
  ms.value = st.modifier ?? 'Control+Alt+Command';
  const mod = MODIFIERS.find((m) => m.value === ms.value);
  $('#kbModNote').innerHTML = `Global: <b>${mod ? mod.label : ''} + Taste</b> – ${esc(mod ? mod.note : '')}`;
  $('#kbHint').textContent = `${Object.keys(st.mappings).length} Tasten belegt`;
  $('#globalHotkeys').checked = st.globalHotkeys;
  $('#showDaw').checked = st.showDawShortcuts !== false;
}

function showKeyMenu(e, keyId, m, p) {
  const menu = $('#menu');
  menu.classList.remove('flip');
  menu.innerHTML = `
    <div class="msub">${esc(keyLabel(keyId))} · ${esc(p.name)}</div>
    <div data-a="load">Jetzt laden</div>
    <div data-a="newtrack">${m.newTrack ? '✓ ' : ''}Auf neuer Spur laden</div>
    <hr>
    <div data-a="remove">Taste freigeben</div>`;
  menu.classList.remove('hidden');
  menu.style.left = `${Math.min(e.clientX, innerWidth - 220)}px`;
  menu.style.top = `${Math.max(10, Math.min(e.clientY, innerHeight - menu.offsetHeight - 10))}px`;
  menu.onclick = async (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    menu.classList.add('hidden');
    if (a === 'load') load({ id: p.id, name: p.name }, { newTrack: m.newTrack });
    if (a === 'remove') unassign(keyId);
    if (a === 'newtrack') {
      await save({ mappings: { ...state.settings.mappings, [keyId]: { id: m.id, newTrack: !m.newTrack } } });
      toast(`${keyLabel(keyId)}: ${p.name} ${!m.newTrack ? 'wird auf einer neuen Spur geladen' : 'wird auf der ausgewählten Spur geladen'}`);
      render();
    }
  };
}

// ---------- actions ----------
async function load(it, opts = {}) {
  toast(`Lade ${it.name}${opts.newTrack ? ' auf neue Spur' : ''} …`);
  const r = await window.api.loadPlugin(it.id, opts);
  if (r.ok) toast(`✓ ${it.name} geladen`);
  else if (r.error && r.error.startsWith('Indexierung')) toast(r.error, true);
}

async function assign(key, id) {
  const mappings = { ...state.settings.mappings };
  let newTrack = false;
  for (const [k, v] of Object.entries(mappings)) if (mapVal(v).id === id) { newTrack = mapVal(v).newTrack; delete mappings[k]; }
  mappings[key] = { id, newTrack };
  state.assigning = null;
  await save({ mappings });
  const p = state.library.find((x) => x.id === id);
  toast(`${p?.name} → Taste ${keyLabel(key)}`);
  render();
}

async function unassign(key) {
  const mappings = { ...state.settings.mappings };
  delete mappings[key];
  await save({ mappings });
  render();
}

// Right-click menu for one card – or for all selected cards when the card is part of a ⌘-click selection.
function showMenu(e, clicked) {
  const m = $('#menu');
  const all = items();
  const targets = state.selected.size && state.selected.has(clicked.id)
    ? all.filter((x) => state.selected.has(x.id)) : [clicked];
  const it = targets[0];
  const multi = targets.length > 1;
  const ids = targets.flatMap((t) => t.ids);
  const fav = targets.every(isFav);
  const key = !multi && keyFor(it);
  const pic = customImg(it) || shotFor(it) || (it.icon && !sharedIcons.has(it.icon) ? it.icon : null);
  // Categories (with subcategories) that exist for this plugin's type.
  const cats = {};
  for (const p of state.library) if (p.type === it.type) (cats[p.category] ||= new Set()).add(p.sub);
  const catNames = Object.keys(cats).sort((a, b) => (a === 'Unsorted') - (b === 'Unsorted') || a.localeCompare(b));
  const otherTypes = ['Effect', 'Instrument', 'MIDI FX'].filter((t) => t !== it.type);
  const hostable = it.formats.some((f) => f === 'AU' || f === 'VST3') && state.snapshotsAvailable;
  const liveCapturable = !hostable && state.liveIndexAvailable && it.source !== 'Preset';

  m.innerHTML = `
    <div class="mhead">
      ${multi ? `<div class="mthumb mcount">${targets.length}</div>` : pic ? `<img class="mthumb" src="${imgUrl(pic)}">` : `<div class="mthumb">${esc(initials(it.name))}</div>`}
      <div><b>${multi ? `${targets.length} Plugins ausgewählt` : esc(it.name)}</b><span>${multi ? esc(targets.slice(0, 3).map((t) => t.name).join(', ')) + (targets.length > 3 ? ' …' : '') : `${esc(it.vendor)} · ${esc(it.formats.join(', '))}`}</span></div>
    </div>
    ${!multi ? `<div data-a="load">In Live laden</div><div data-a="loadnew">Auf neuer Spur laden</div>` : ''}
    <hr>
    <div class="msub">Sammlungen</div>
    <div class="mchips">
      ${collections().map((c) => { const on = targets.every((t) => inColl(t, c)); return `<span class="mchip${on ? ' on' : ''}" data-a="coll" data-v="${c.id}"><i style="background:${c.color}"></i>${esc(c.name)}</span>`; }).join('')}
      <span class="mchip" data-a="newcoll">＋ Neue Sammlung</span>
    </div>
    <hr>
    <div class="mrow has-sub">Typ <span class="mval">${multi ? '' : esc(TYPE_LABELS[it.type] || it.type)} ›</span>
      <div class="msubmenu">
        ${['Effect', 'Instrument', 'MIDI FX'].map((t) => {
          const tc = {};
          for (const p of state.library) if (p.type === t) tc[p.category] = true;
          const names = Object.keys(tc).filter((c) => c !== 'Unsorted').sort();
          return `<div class="mrow has-sub" data-a="settype" data-v="${t}|Unsorted">${targets.every((x) => x.type === t) ? '✓ ' : ''}${esc(TYPE_LABELS[t])} ›
            <div class="msubmenu">${names.map((c) => `<div data-a="settype" data-v="${t}|${esc(c)}">${esc(c)}</div>`).join('')}<hr><div data-a="settype" data-v="${t}|Unsorted">Unsorted (später zuordnen)</div></div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="mrow has-sub">Kategorie <span class="mval">${multi ? '' : esc(it.sub !== it.category ? `${it.category} › ${it.sub}` : it.category)} ›</span>
      <div class="msubmenu">
        ${catNames.map((c) => `<div class="mrow has-sub" data-a="cat" data-v="${esc(c)}|${esc(c)}">${it.category === c ? '✓ ' : ''}${esc(c)}${cats[c].size > 1 ? ' ›' : ''}
          ${cats[c].size > 1 ? `<div class="msubmenu">${[...cats[c]].sort().map((sb) => `<div data-a="cat" data-v="${esc(c)}|${esc(sb)}">${it.category === c && it.sub === sb ? '✓ ' : ''}${esc(sb)}</div>`).join('')}</div>` : ''}
        </div>`).join('')}
        <hr>
        ${otherTypes.map((t) => `<div data-a="type" data-v="${t}">Ist eigentlich: ${TYPE_LABELS[t]}</div>`).join('')}
      </div>
    </div>
    ${!multi ? '<div data-a="selectmode">Mehrere umkategorisieren …</div>' : '<div data-a="clearsel">Auswahl aufheben</div>'}
    <hr>
    <div class="msub">Bild</div>
    ${hostable || liveCapturable ? `<div data-a="shot">${shotFor(it) ? 'Neu aufnehmen' : 'Aufnehmen'}${liveCapturable ? ' (in Live)' : ''}</div>` : ''}
    ${!multi ? '<div data-a="image">Eigenes Bild wählen …</div>' : ''}
    ${targets.some(customImg) ? '<div data-a="noimage">Eigenes Bild entfernen</div>' : ''}
    <hr>
    ${!multi ? `<div data-a="assign">Taste zuweisen …</div>${key ? `<div data-a="unassign">Taste ${esc(keyLabel(key))} freigeben</div>` : ''}` : ''}
    <div data-a="fav">${fav ? 'Aus Favoriten entfernen' : '★ Zu Favoriten'}</div>
    ${state.showHidden
      ? '<div data-a="unhide">Wieder in die Bibliothek aufnehmen</div>'
      : `<div data-a="hide" class="danger">Aus Bibliothek entfernen<small>Bleibt installiert</small></div>`}`;
  m.classList.remove('hidden');
  m.style.left = `${Math.min(e.clientX, innerWidth - 280)}px`;
  m.style.top = `${Math.max(8, Math.min(e.clientY, innerHeight - m.offsetHeight - 10))}px`;
  // Submenus open to the left when there is no room on the right.
  m.classList.toggle('flip', e.clientX > innerWidth - 700);
  m.onclick = async (ev) => {
    const el = ev.target.closest('[data-a]');
    const a = el?.dataset.a;
    if (!a) return;
    ev.stopPropagation();
    const v = el.dataset.v;
    const st = state.settings;
    // Collection chips toggle in place, the menu stays open.
    if (a === 'coll') {
      const c = collections().find((x) => x.id === v);
      const on = targets.every((t) => inColl(t, c));
      await saveCollections(collections().map((x) => (x.id !== v ? x : on
        ? { ...x, ids: x.ids.filter((id) => !ids.includes(id)) }
        : { ...x, ids: [...new Set([...x.ids, ...ids])] })));
      el.classList.toggle('on', !on);
      return;
    }
    m.classList.add('hidden');
    if (a === 'load') load(it);
    if (a === 'loadnew') load(it, { newTrack: true });
    if (a === 'newcoll') { newCollection({ name: multi ? `${targets.length} Plugins` : it.name, ids }); return; }
    if (a === 'cat') {
      const [category, sub] = v.split('|');
      const o = { ...st.categoryOverrides };
      for (const t of targets) for (const id of t.ids) o[id] = { type: t.type, category, sub };
      await save({ categoryOverrides: o });
      toast(`${multi ? `${targets.length} Plugins` : it.name} → ${category}${sub !== category ? ` › ${sub}` : ''}`);
      state.selected.clear();
    }
    if (a === 'settype') {
      const [type, category] = v.split('|');
      const o = { ...st.categoryOverrides };
      for (const id of ids) o[id] = { type, category, sub: category };
      await save({ categoryOverrides: o });
      toast(`${multi ? `${targets.length} Plugins` : it.name} → ${TYPE_LABELS[type]}${category !== 'Unsorted' ? ` › ${category}` : ''}`);
      state.selected.clear();
    }
    if (a === 'type') {
      const o = { ...st.categoryOverrides };
      for (const id of ids) o[id] = { type: v, category: 'Unsorted', sub: 'Unsorted' };
      await save({ categoryOverrides: o });
      toast(`${multi ? `${targets.length} Plugins` : it.name} → ${TYPE_LABELS[v]} (Kategorie „Unsorted“)`);
      state.selected.clear();
    }
    if (a === 'selectmode') { state.selected = new Set([it.id]); toast('⌘-Klick auf weitere Karten zum Auswählen, dann Rechtsklick → Kategorie'); }
    if (a === 'clearsel') state.selected.clear();
    if (a === 'shot') {
      if (hostable) { window.api.snapshot(ids, true); toast(`Nehme ${multi ? `${targets.length} Plugins` : it.name} auf …`); }
      else {
        const r = await window.api.liveIndexSome(ids);
        toast(r?.error || `Nehme ${multi ? `${targets.length} Plugins` : it.name} in Live auf …`, Boolean(r?.error));
      }
    }
    if (a === 'image') { const p = await window.api.pickImage(); if (p) await save({ images: { ...st.images, [it.id]: p } }); }
    if (a === 'noimage') { const images = { ...st.images }; ids.forEach((id) => delete images[id]); await save({ images }); }
    if (a === 'assign') { state.assigning = it.id; }
    if (a === 'unassign') unassign(key);
    if (a === 'fav') await save({ favorites: fav ? st.favorites.filter((id) => !ids.includes(id)) : [...new Set([...st.favorites, ...ids])] });
    if (a === 'hide') { await hidePlugins(targets); return; }
    if (a === 'unhide') { await save({ hidden: st.hidden.filter((id) => !ids.includes(id)) }); toast(`${multi ? `${targets.length} Plugins` : it.name} wieder in der Bibliothek`); state.selected.clear(); }
    render();
  };
}

async function hidePlugins(targets) {
  const ids = targets.flatMap((t) => t.ids);
  await save({ hidden: [...new Set([...state.settings.hidden, ...ids])] });
  state.selected.clear();
  toast(`${targets.length > 1 ? `${targets.length} Plugins` : targets[0].name} ausgeblendet – unter „Ausgeblendete zeigen“ wiederherstellbar`);
  render();
}

// ---------- preview ----------
let previewTimer;
function showPreview(e, file) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const pv = $('#preview');
    pv.querySelector('img').src = imgUrl(file);
    pv.classList.remove('hidden');
    movePreview(e);
  }, 450);
}
function movePreview(e) {
  const pv = $('#preview');
  const w = pv.offsetWidth || 400;
  const h = pv.offsetHeight || 300;
  let x = e.clientX + 18;
  let y = e.clientY + 18;
  if (x + w > innerWidth - 10) x = e.clientX - w - 18;
  if (y + h > innerHeight - 10) y = Math.max(10, innerHeight - h - 10);
  pv.style.left = `${x}px`;
  pv.style.top = `${y}px`;
}
function hidePreview() { clearTimeout(previewTimer); $('#preview').classList.add('hidden'); }

// ---------- snapshots ----------
let shotRenderTimer;
function updateShotsButton(u) {
  const b = $('#shotsBtn');
  if (!state.snapshotsAvailable) { b.classList.add('hidden'); return; }
  if (u?.running) {
    b.classList.add('busy');
    b.textContent = `${u.done}/${u.total} – Stopp`;
  } else {
    b.classList.remove('busy');
    b.textContent = 'Ansichten';
  }
}

// ---------- events ----------
document.addEventListener('click', (e) => { if (!$('#menu').contains(e.target)) $('#menu').classList.add('hidden'); });

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (e.key === 'Escape') {
    if (state.selected.size) { state.selected.clear(); render(); return; }
    if (state.assigning) { state.assigning = null; render(); return; }
    $('#search').value = ''; state.query = ''; $('#search').blur(); render(); return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
  const k = keyIdFromEvent(e);
  if (!k) return;
  if (state.assigning) { e.preventDefault(); assign(k, state.assigning); return; }
  const m = mapVal(state.settings.mappings[k]);
  const p = m && state.library.find((x) => x.id === m.id);
  if (p) { e.preventDefault(); load(p, { newTrack: m.newTrack }); }
});

$('#search').oninput = (e) => { state.miniSel = 0; if (document.body.classList.contains('health')) showView('library'); state.query = e.target.value.trim(); render(); };
$('#search').onkeydown = (e) => {
  const side = state.windowMode === 'sidecar' || state.windowMode === 'mini';
  if (state.windowMode === 'mini' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    state.miniSel = Math.max(0, (state.miniSel || 0) + (e.key === 'ArrowDown' ? 1 : -1));
    render();
    document.querySelector('.mini-row.sel')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') {
    if (side) { const it = (state.lastShown || [])[state.windowMode === 'mini' ? state.miniSel || 0 : 0]; if (it) load(it, { newTrack: e.shiftKey }); return; }
    const first = $('#grid .card'); first?.click();
  }
};
$('#vendorSearch').oninput = (e) => { state.vendorQuery = e.target.value; render(); };
$('#sort').onchange = (e) => { state.sort = e.target.value; render(); };
$('#showHidden').onchange = (e) => { state.showHidden = e.target.checked; state.selected.clear(); render(); };
for (const id of ['groupFormats', 'onlyFavorites', 'onlyMapped', 'onlyNew']) $(`#${id}`).onchange = render;
$('#globalHotkeys').onchange = (e) => save({ globalHotkeys: e.target.checked });
$('#showDaw').onchange = async (e) => { await save({ showDawShortcuts: e.target.checked }); renderKeyboard(); };
$('#kbLayout').onchange = async (e) => { await save({ keyboardLayout: e.target.value }); renderKeyboard(); };
$('#kbModifier').onchange = async (e) => {
  await save({ modifier: e.target.value });
  renderKeyboard();
  toast(`Globale Hotkeys jetzt: ${MODIFIERS.find((m) => m.value === e.target.value)?.label} + Taste`);
};
$('#toggleKb').onclick = () => {
  const p = $('.keyboard-panel');
  p.classList.toggle('collapsed');
  $('#toggleKb').textContent = p.classList.contains('collapsed') ? 'Einblenden' : 'Ausblenden';
};
$('#rescan').onclick = async () => {
  $('#rescan').disabled = true;
  state.library = await window.api.rescan();
  state.settings = (await window.api.getState()).settings;
  $('#rescan').disabled = false;
  toast(`${state.library.length} Plugins gefunden`);
  render();
};

window.api.on('snapshots', (u) => {
  if (u.shot) {
    state.shots[u.shot.key] = u.shot.path;
    looseFor = null;
    clearTimeout(shotRenderTimer);
    shotRenderTimer = setTimeout(render, 800);
  } else {
    state.shotsRunning = u.running;
    updateShotsButton(u);
    if (captureRunning && u.total) $('#captureAllBtn').textContent = u.running ? `Stopp (AU/VST3 ${u.done}/${u.total})` : 'Stopp';
  }
});
$('#shotsBtn').onclick = () => {
  if (state.shotsRunning) { window.api.snapshotCancel(); return; }
  toast('Nehme Plugin-Ansichten im Hintergrund auf – das dauert eine Weile.');
  window.api.snapshotAll();
};
const savedSize = (() => { try { return localStorage.getItem('cardSize'); } catch { return null; } })() || '220';
$('#size').value = savedSize;
document.documentElement.style.setProperty('--card-w', `${savedSize}px`);
$('#size').oninput = (e) => {
  document.documentElement.style.setProperty('--card-w', `${e.target.value}px`);
  try { localStorage.setItem('cardSize', e.target.value); } catch { /* ignore */ }
};
// ---------- window modes: sidecar & mini ----------
function thumbHtml(it, cls = 'sv-thumb') {
  const pic = customImg(it) || shotFor(it);
  const h = hue(it.vendor);
  if (pic) return `<div class="${cls}"><img loading="lazy" src="${imgUrl(pic)}"></div>`;
  if (it.icon && !sharedIcons.has(it.icon)) return `<div class="${cls}" style="background:linear-gradient(135deg,hsl(${h} 45% 32%),hsl(${(h + 40) % 360} 50% 20%))"><img class="icon" loading="lazy" src="${imgUrl(it.icon)}"></div>`;
  return `<div class="${cls}" style="background:linear-gradient(135deg,hsl(${h} 45% 32%),hsl(${(h + 40) % 360} 50% 20%))">${esc(initials(it.name))}</div>`;
}

function sideCard(it) {
  const el = document.createElement('div');
  el.className = 'sv-card';
  const tag = it.source === 'Stock' ? 'STOCK' : it.source === 'Max' ? 'MAX' : it.source === 'Preset' ? (it.format === 'Rack' ? 'RACK' : 'PRESET') : '';
  el.innerHTML = `${thumbHtml(it)}${tag ? `<span class="sv-tag">${tag}</span>` : ''}<div class="sv-n" title="${esc(it.name)}">${esc(it.name)}</div><div class="sv-v">${esc(it.vendor)}</div>`;
  el.onclick = (e) => load(it, { newTrack: e.shiftKey });
  el.oncontextmenu = (e) => { e.preventDefault(); showMenu(e, it); };
  return el;
}

function renderSide(shown) {
  const v = $('#sideView');
  v.innerHTML = '';
  if (state.windowMode === 'mini') return renderMini(shown);

  const grid = (list) => { const g = document.createElement('div'); g.className = 'sv-grid'; list.forEach((it) => g.appendChild(sideCard(it))); return g; };
  if (state.query || state.vendor || state.collection) {
    const head = document.createElement('div');
    head.className = 'sv-label';
    head.textContent = `${shown.length} Treffer`;
    v.append(head, shown.length ? grid(shown.slice(0, 200)) : Object.assign(document.createElement('div'), { className: 'sv-empty', textContent: 'Nichts gefunden.' }));
    return;
  }
  if (state.category) {
    const inCat = shown;
    const back = document.createElement('div');
    back.className = 'sv-back';
    back.innerHTML = `<button title="Zurück">‹</button><i class="ci" style="font-style:normal;color:var(--accent)">${CAT_ICONS[state.category] || '•'}</i>${esc(state.category)}${state.sub ? ` › ${esc(state.sub)}` : ''}<span class="sv-count">${inCat.length}</span>`;
    back.querySelector('button').onclick = () => { if (state.sub) state.sub = null; else state.category = null; render(); };
    v.appendChild(back);
    // Group by subcategory, like the category view.
    const subs = count(inCat, (i) => i.sub);
    const keys = Object.keys(subs).sort((a, b) => subs[b] - subs[a]);
    for (const sub of keys) {
      if (keys.length > 1) {
        const l = document.createElement('div');
        l.className = 'sv-label sv-sublink';
        l.textContent = `${sub} · ${subs[sub]}`;
        l.style.cursor = 'pointer';
        l.onclick = () => { state.sub = sub; render(); };
        v.appendChild(l);
      }
      v.appendChild(grid(inCat.filter((i) => i.sub === sub)));
    }
    return;
  }
  // Overview: one row per category with a horizontal strip of plugins.
  for (const [cat, n] of sortCounts(count(shown, (i) => i.category))) {
    const head = document.createElement('div');
    head.className = 'sv-head';
    head.innerHTML = `<i class="ci">${CAT_ICONS[cat] || '•'}</i><span class="sv-name">${esc(cat)}</span><span class="sv-count">${n} ›</span>`;
    head.onclick = () => { state.category = cat; state.sub = null; render(); v.scrollTop = 0; };
    const strip = document.createElement('div');
    strip.className = 'sv-strip';
    // Pictures first, so the strip looks like the plugins.
    const items = shown.filter((i) => i.category === cat).sort((a, b) => (shotFor(b) || customImg(b) ? 1 : 0) - (shotFor(a) || customImg(a) ? 1 : 0)).slice(0, 14);
    items.forEach((it) => strip.appendChild(sideCard(it)));
    v.append(head, strip);
  }
}

// Mini: search-first result list, ↑/↓ to choose, Enter to load.
function renderMini(shown) {
  const v = $('#sideView');
  const list = shown.slice(0, 60);
  state.miniSel = Math.min(state.miniSel || 0, Math.max(0, list.length - 1));
  if (!state.query) {
    const hint = document.createElement('div');
    hint.className = 'mini-hint';
    hint.textContent = 'Tippen zum Suchen · ↑/↓ wählen · Enter lädt · ⇧Enter auf neuer Spur';
    v.appendChild(hint);
  }
  list.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = `mini-row${i === state.miniSel ? ' sel' : ''}`;
    row.innerHTML = `${thumbHtml(it, 'mt')}<div style="min-width:0"><b>${esc(it.name)}</b><span>${esc(it.vendor)} · ${esc(it.sub && it.sub !== it.category ? it.sub : it.category)}</span></div>`;
    row.onclick = (e) => load(it, { newTrack: e.shiftKey });
    row.oncontextmenu = (e) => { e.preventDefault(); showMenu(e, it); };
    v.appendChild(row);
  });
  if (!list.length) v.innerHTML = '<div class="sv-empty">Nichts gefunden.</div>';
}

function applyModeClass() {
  const m = state.windowMode || 'full';
  document.body.classList.toggle('mode-sidecar', m === 'sidecar');
  document.body.classList.toggle('mode-mini', m === 'mini');
  document.querySelectorAll('#modeMenu [data-mode]').forEach((d) => d.classList.toggle('on', d.dataset.mode === m));
  $('#modeBtn').textContent = m === 'sidecar' ? '◧' : m === 'mini' ? '▢' : '▭';
  if (m !== 'full') showView('library');
}

async function setMode(m) {
  state.windowMode = m;
  state.category = null; state.sub = null;
  applyModeClass();
  render();
  await window.api.setWindowMode(m);
  if (m === 'mini') $('#search').focus();
}
$('#modeBtn').onclick = (e) => { e.stopPropagation(); $('#modeMenu').classList.toggle('hidden'); };
$('#modeMenu').onclick = (e) => { const d = e.target.closest('[data-mode]'); if (!d) return; $('#modeMenu').classList.add('hidden'); setMode(d.dataset.mode); };
document.addEventListener('click', (e) => { if (!e.target.closest('.modewrap')) $('#modeMenu').classList.add('hidden'); });

// ---------- settings: window behaviour ----------
const ACCEL_LABELS = { PageUp: 'Bild↑', PageDown: 'Bild↓', Home: 'Pos1', End: 'Ende', Up: '↑', Down: '↓', Left: '←', Right: '→', Space: 'Leertaste', Delete: '⌦', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };
const accelLabel = (a) => (a ? a.split('+').map((k) => ACCEL_LABELS[k] || (k.startsWith('num') ? `Num ${k.slice(3)}` : k)).join('') : '–');

function renderSettings() {
  const st = state.settings;
  $('#setOnTop').checked = Boolean(st.alwaysOnTop);
  $('#setHideAfter').checked = Boolean(st.hideAfterLoad);
  $('#setAutoUpdate').checked = st.autoUpdate !== false;
  $('#setAutoRescan').checked = st.autoRescan !== false;
  showLiveScript();
  window.api.autostartGet().then((on) => { $('#setAutostart').checked = on; });
  $('#setVersion').textContent = state.version || '';
  $('#setToggleKey').textContent = accelLabel(st.toggleKey);
  $('#hideKey').textContent = accelLabel(st.toggleKey);
  $('#hideKey').classList.toggle('hidden', !st.toggleKey);
}
// Links to homepage, donations and GitHub open in the browser.
document.addEventListener('click', (e) => {
  const l = e.target.closest('[data-link]');
  if (!l) return;
  e.preventDefault();
  window.api.openLink(l.dataset.link);
});
$('#settingsBtn').onclick = () => { renderSettings(); $('#settingsModal').classList.remove('hidden'); };
$('#settingsClose').onclick = () => $('#settingsModal').classList.add('hidden');
$('#settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('#settingsModal').classList.add('hidden'); };
$('#setOnTop').onchange = async (e) => { await save({ alwaysOnTop: e.target.checked }); renderSettings(); };
$('#setHideAfter').onchange = async (e) => { await save({ hideAfterLoad: e.target.checked }); renderSettings(); };
$('#clearToggleKey').onclick = async () => { await save({ toggleKey: '' }); renderSettings(); };
$('#hideBtn').onclick = () => window.api.toggleWindow();

// ---------- Updates ----------
$('#setAutostart').onchange = async (e) => { e.target.checked = await window.api.autostartSet(e.target.checked); };
// ---------- Live script: installed? selected in Live? ----------
function liveScriptText(s) {
  if (!s.folder) return 'Keine User Library von Ableton Live gefunden – ist Live installiert und einmal gestartet worden?';
  if (!s.installed) return 'Nicht installiert. „Installieren“ kopiert es in deine User Library.';
  if (s.outdated) return 'Aktiv, aber Live nutzt noch die alte Fassung des Skripts. Live einmal neu starten, damit die neue geladen wird.';
  if (s.active) return '✓ Aktiv – Plugins werden direkt über Live geladen (schnell und exakt).';
  return 'Installiert, aber in Live nicht aktiv. Live neu starten, dann Einstellungen → Link, Tempo & MIDI → Control Surface „Frequenzbetrieb“ wählen (Input/Output: None). Bis dahin lädt die App über die Suche.';
}
async function showLiveScript(s) {
  s = s || await window.api.liveScriptStatus();
  $('#lsStatus').textContent = liveScriptText(s);
  $('#lsInstall').classList.toggle('hidden', s.installed);
  return s;
}
$('#lsCheck').onclick = () => { $('#lsStatus').textContent = 'Prüfe …'; showLiveScript(); };
$('#lsInstall').onclick = async () => showLiveScript(await window.api.liveScriptInstall());
// Setup guide: shows the steps and watches until Live answers, then confirms.
let lsTimer = null;
async function lsPoll() {
  const s = await window.api.liveScriptStatus();
  const live = (await window.api.dawStatus()).ableton;
  $('#lsState').className = `ls-state${s.active ? ' ok' : ''}`;
  $('#lsState').textContent = s.active ? '✓ Live-Skript ist aktiv – Laden läuft jetzt direkt über Live.'
    : !s.installed ? 'Skript fehlt in der User Library – wird jetzt installiert …'
    : live ? 'Live läuft, das Skript ist aber noch nicht aktiv (Schritte 1–3).' : 'Live ist nicht geöffnet – bitte Live starten.';
  if (!s.installed && s.folder !== null) await window.api.liveScriptInstall();
  $('#lsClose').textContent = s.active ? 'Fertig' : 'Später';
  showLiveScript(s);
  if (s.active) { clearInterval(lsTimer); lsTimer = null; }
}
function openLiveScriptGuide() {
  $('#lsNever').checked = Boolean(state.settings.liveScriptGuideOff);
  $('#lsModal').classList.remove('hidden');
  lsPoll();
  clearInterval(lsTimer);
  lsTimer = setInterval(lsPoll, 3000);
}
const closeLsGuide = () => { $('#lsModal').classList.add('hidden'); clearInterval(lsTimer); lsTimer = null; };
$('#lsClose').onclick = closeLsGuide;
$('#lsRecheck').onclick = lsPoll;
$('#lsGuide').onclick = openLiveScriptGuide;
$('#lsNever').onchange = (e) => save({ liveScriptGuideOff: e.target.checked });
// Once per start: when Live runs without the script, open the guide (unless switched off).
setTimeout(async () => {
  if (state.settings.liveScriptGuideOff) return;
  const live = (await window.api.dawStatus()).ableton;
  const s = await window.api.liveScriptStatus();
  if (live && !s.active) openLiveScriptGuide();
  else if (live && s.outdated) toast('Das Live-Skript wurde aktualisiert – Live bei Gelegenheit neu starten, damit es die neue Fassung lädt.');
}, 6000);
$('#factoryReset').onclick = async () => {
  const r = await window.api.factoryReset();
  if (r?.error) toast(r.error, true);
};
$('#setAutoRescan').onchange = async (e) => { await save({ autoRescan: e.target.checked }); renderSettings(); };
const mb = (n) => `${Math.round(n / 1e6)} MB`;
$('#backupExport').onclick = async () => {
  $('#backupStatus').textContent = 'Sichere … (die Plugin-Bilder brauchen einen Moment)';
  const r = await window.api.backupExport();
  $('#backupStatus').textContent = r.ok ? `Gesichert: ${r.file.split(/[\\/]/).pop()} (${mb(r.size)})` : r.error ? `Sichern fehlgeschlagen: ${r.error}` : 'Abgebrochen.';
};
$('#backupImport').onclick = async () => {
  $('#backupStatus').textContent = 'Stelle wieder her …';
  const r = await window.api.backupImport();
  if (!r.ok) $('#backupStatus').textContent = r.error ? `Wiederherstellen fehlgeschlagen: ${r.error}` : 'Abgebrochen.';
};
window.api.on('rescanned', ({ added, removed }) => {
  const parts = [added && `${added} neu`, removed && `${removed} entfernt`].filter(Boolean).join(', ');
  toast(`Plugin-Ordner geändert – ${parts}`);
});
$('#setAutoUpdate').onchange = async (e) => { await save({ autoUpdate: e.target.checked }); renderSettings(); };
$('#updateCheck').onclick = () => { $('#updateStatus').textContent = 'Suche …'; window.api.updateCheck(); };
window.api.on('update', (u) => {
  if (u.error) { $('#updateStatus').textContent = `Prüfen fehlgeschlagen: ${u.error}`; return; }
  if (u.none) { $('#updateStatus').textContent = 'Du hast die neueste Version.'; return; }
  $('#updateStatus').textContent = `Version ${u.version} ist verfügbar.`;
  $('#updText').textContent = `Neue Version ${u.version} verfügbar – die App lädt sie herunter, tauscht sich aus und startet neu.`;
  $('#updbar').classList.remove('hidden');
});
window.api.on('update-progress', (f) => { $('#updText').textContent = `Update wird geladen … ${Math.round(f * 100)} %`; });
$('#updLater').onclick = () => $('#updbar').classList.add('hidden');
$('#updInstall').onclick = async () => {
  $('#updInstall').disabled = true;
  const r = await window.api.updateInstall();
  if (!r.ok) { $('#updText').textContent = `Update fehlgeschlagen: ${r.error}`; $('#updInstall').disabled = false; }
  else $('#updText').textContent = 'Update installiert – die App startet neu …';
};
// Record a key combination for the toggle key.
$('#setToggleKey').onclick = () => {
  const b = $('#setToggleKey');
  b.classList.add('recording');
  b.textContent = 'Taste drücken …';
  const onKey = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return; // wait for the actual key
    window.removeEventListener('keydown', onKey, true);
    b.classList.remove('recording');
    if (e.key === 'Escape') { renderSettings(); return; }
    const key = keyIdFromEvent(e);
    if (!key) { toast('Diese Taste geht nicht – nimm z. B. eine F-Taste, Bild↑/↓ oder eine Kombination mit ⌘/⌃/⌥', true); renderSettings(); return; }
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean);
    await save({ toggleKey: [...mods, key].join('+') });
    renderSettings();
    toast(`Ein-/Ausblenden: ${accelLabel(state.settings.toggleKey)}`);
  };
  window.addEventListener('keydown', onKey, true);
};

window.api.on('window-mode', (m) => { if (m !== state.windowMode) { state.windowMode = m; applyModeClass(); render(); } });
window.api.on('liveindex', (u) => {
  if (u.error) { toast(u.error, true); }
  if (u.shot) return;
  if (u.total === undefined) return;
  const bar = $('#idxbar');
  bar.classList.toggle('hidden', !u.running);
  $('#idxText').textContent = `Indexiere in Ableton: ${u.done} / ${u.total}${u.current ? ` · ${u.current}` : ''}`;
  if (!u.running && u.total) toast(`Indexierung fertig: ${u.done} von ${u.total}`);
});
$('#liveIdxBtn').onclick = async () => {
  const r = await window.api.liveIndexStart(true);
  if (r?.error) toast(r.error, true);
  else if (r?.ok) toast(`${r.total} Plugins/Devices ohne Bild werden in Ableton aufgenommen …`);
};
$('#idxStop').onclick = () => window.api.liveIndexStop();
let captureRunning = false;
$('#captureAllBtn').onclick = async () => {
  if (captureRunning) { window.api.captureAllStop(); return; }
  const r = await window.api.captureAll();
  if (r?.error) toast(r.error, true);
};
window.api.on('capture-all', (u) => {
  const b = $('#captureAllBtn');
  captureRunning = !['done', 'error'].includes(u.phase);
  b.disabled = u.phase === 'scan';
  b.textContent = { scan: 'Scanne …', host: 'Stopp (AU/VST3 …)', live: 'Stopp (in Live …)' }[u.phase] || 'Alle Bilder';
  if (u.phase === 'host') toast('Schritt 1/2: AU- und VST3-Plugins werden im Hintergrund fotografiert …');
  if (u.phase === 'live') toast('Schritt 2/2: VST2, Stock und Max werden in Live aufgenommen – Live vorne lassen.');
  if (u.phase === 'done' && u.stopped) toast('Aufnahme gestoppt.');
  else if (u.phase === 'done') toast(u.live ? 'Alle Bilder aufgenommen.' : 'AU/VST3 fertig. Für VST2, Stock und Max Live öffnen und erneut starten.');
  if (u.phase === 'error') toast(`Abgebrochen: ${u.error}`, true);
});
window.api.on('scan-progress', ({ done, total }) => { $('#status').textContent = `Scanne Plugins … ${done}/${total}`; });
// A rescan also updates "firstSeen" (NEU badges) in the settings.
window.api.on('library', async (lib) => { state.library = lib; state.settings = (await window.api.getState()).settings; render(); });
window.api.on('loaded', ({ name }) => toast(`✓ ${name} geladen`));
window.api.on('load-error', ({ error }) => toast(error, true));

async function pollDaw() {
  const { ableton } = await window.api.dawStatus();
  $('#daw').className = `daw ${ableton ? 'on' : 'off'}`;
  $('#daw').title = ableton ? 'Ableton Live läuft' : 'Ableton Live nicht gestartet';
}

(async () => {
  const s = await window.api.getState();
  if (!s.liveIndexAvailable) $('#liveIdxBtn').classList.add('hidden');
  $("#appVersion").textContent = `v${s.version}`;
  state.version = s.version;
  Object.assign(state, { shots: s.shots, snapshotsAvailable: s.snapshotsAvailable, liveIndexAvailable: s.liveIndexAvailable, library: s.library, settings: s.settings, supportedFormats: s.supportedFormats, platform: s.platform });
  state.windowMode = s.settings.windowMode || 'full';
  applyModeClass();
  render();
  renderSettings();
  updateShotsButton();
  pollDaw();
  setInterval(pollDaw, 3000);
  window.api.checkAccessibility();
})();

// ---------- library health ----------
const health = { data: null, list: null };
const gb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const bigGb = (b) => (b >= 1e9 ? `${Math.round(b / 1e9)}<small>GB</small>` : `${Math.round(b / 1e6)}<small>MB</small>`);
const shotByKey = (k) => { const v = state.shots[k]; return v && v !== 'failed' ? v : null; };

function thumbs(items) {
  const withShot = items.filter((i) => shotByKey(i.key)).slice(0, 3);
  if (!withShot.length) return '';
  const rest = items.length - withShot.length;
  return `<div class="thumbs">${withShot.map((i) => `<img src="${imgUrl(shotByKey(i.key))}" title="${esc(i.name)}">`).join('')}${rest > 0 ? `+${rest}` : ''}</div>`;
}

const SECTIONS = {
  intelOnly: { title: 'Laden nicht', text: () => 'Plugins brauchen Rosetta, das Apple abschafft', list: 'Nur als Intel-Version vorhanden' },
  neverLoaded: { title: 'Nie geladen', text: () => 'Plugins nie aus dem Plugin Organizer geladen', list: 'Nie aus dem Plugin Organizer geladen' },
  vst2Copies: { title: 'VST2-Kopien', text: () => 'Plugins, die du auch als VST3 hast', list: 'VST2-Versionen mit VST3-Gegenstück' },
  aax: { title: 'Pro-Tools-Dateien', text: () => 'AAX-Plugins, aber kein Pro Tools installiert', list: 'AAX-Plugins ohne Pro Tools' },
};

function healthCard(id) {
  const sec = health.data[id];
  const def = SECTIONS[id];
  if (!sec.items.length) return '';
  return `<div class="hcard">
    <h4>${def.title}</h4>
    <div class="num">${id === 'intelOnly' ? sec.items.length : gb(sec.size)}<small>${id === 'intelOnly' ? '' : `${sec.items.length} `}${def.text(health.data)}</small></div>
    ${thumbs(sec.items)}
    <div class="actions">
      <button class="btn" data-list="${id}">Alle ${sec.items.length} anzeigen</button>
      ${id === 'aax' ? `<button class="btn" data-folder="${esc(sec.items[0].paths[0])}">Im Finder zeigen</button>` : ''}
    </div>
  </div>`;
}

function renderHealth() {
  const v = $('#healthView');
  const d = health.data;
  if (!d) { v.innerHTML = `<div class="hw"><p class="status" id="healthStatus">Analysiere Bibliothek …</p></div>`; return; }

  if (health.list) return renderHealthList();

  const s = d.sessions;
  const pct = d.total ? Math.round((d.reclaimable / d.total) * 100) : 0;
  v.innerHTML = `<div class="hw">
    <div class="hero">
      <div class="big">${bigGb(d.reclaimable)}</div>
      <p><b>kannst du zurückholen</b> · ${gb(d.total)} Plugins auf diesem ${state.platform === 'darwin' ? 'Mac' : 'PC'}</p>
      <div class="bar"><div style="width:${pct}%"></div></div>
    </div>
    <div class="hcards">
      <div class="hcard wide">
        <h4>Deine Sessions</h4>
        <p>Der Plugin Organizer liest deine Ableton-Live-Sets: welche Plugins darin stecken, was auf diesem Rechner fehlt und was nie vorkommt. Füge die Ordner hinzu, in denen deine Projekte liegen.</p>
        <div class="chips">
          ${s.folders.map((f) => `<div class="chip">${esc(f.split('/').pop() || f)} <span>${esc(f)}</span><button data-rm="${esc(f)}" title="Entfernen">✕</button></div>`).join('')}
          <button class="btn" id="addFolder">+ Ordner hinzufügen</button>
        </div>
        ${s.setCount
          ? `<p><b>${s.setCount}</b> Live-Sets · <b>${s.usedCount}</b> verschiedene Plugins benutzt${s.missing.length ? ` · <b style="color:#e5484d">${s.missing.length} fehlen auf diesem Rechner</b>` : ''}</p>
             <div class="chips">
               ${s.missing.length ? '<button class="btn" data-list="missing">Fehlende anzeigen</button>' : ''}
               <button class="btn" data-list="topUsed">Meistbenutzt</button>
               ${s.neverUsed.items.length ? `<button class="btn" data-list="neverUsed">${s.neverUsed.items.length} nie in einem Set (${gb(s.neverUsed.size)})</button>` : ''}
             </div>`
          : '<p>Noch keine Live-Sets in diesen Ordnern gefunden.</p>'}
      </div>
      ${['intelOnly', 'neverLoaded', 'vst2Copies', 'aax'].map(healthCard).join('')}
    </div>
  </div>`;

  v.querySelectorAll('[data-list]').forEach((b) => { b.onclick = () => { health.list = b.dataset.list; renderHealth(); v.scrollTop = 0; }; });
  v.querySelectorAll('[data-folder]').forEach((b) => { b.onclick = () => window.api.showInFinder(b.dataset.folder); });
  v.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { await window.api.removeSessionFolder(b.dataset.rm); refreshHealth(); }; });
  $('#addFolder').onclick = async () => { await window.api.addSessionFolder(); refreshHealth(); };
}

function renderHealthList() {
  const v = $('#healthView');
  const d = health.data;
  const id = health.list;
  const back = '<button class="btn" id="hBack">← Zurück</button>';
  let title;
  let rows;

  if (id === 'missing' || id === 'topUsed') {
    const items = id === 'missing' ? d.sessions.missing : d.sessions.topUsed;
    title = id === 'missing' ? 'Fehlen auf diesem Rechner' : 'Meistbenutzt in deinen Sets';
    rows = items.map((i) => `<div class="hrow"><div class="ph"></div>
      <div><div class="name">${esc(i.name)}</div><div class="meta">${esc(i.sets.slice(0, 4).join(', '))}${i.sets.length > 4 ? ` +${i.sets.length - 4}` : ''}</div></div>
      <div class="sz">${i.sets.length} Set${i.sets.length === 1 ? '' : 's'}</div><div></div></div>`).join('');
  } else {
    const sec = id === 'neverUsed' ? d.sessions.neverUsed : d[id];
    title = id === 'neverUsed' ? 'Kommen in keinem Live-Set vor' : SECTIONS[id].list;
    rows = sec.items.map((i, n) => {
      const shot = shotByKey(i.key);
      return `<div class="hrow">${shot ? `<img loading="lazy" src="${imgUrl(shot)}">` : '<div class="ph"></div>'}
        <div><div class="name">${esc(i.name)}</div><div class="meta">${esc(i.vendor)} · ${i.formats.join(', ')}</div></div>
        <div class="sz">${gb(i.size)}</div>
        <button class="btn small" data-finder="${n}">Im Finder zeigen</button></div>`;
    }).join('');
    v.onclick = (e) => {
      const n = e.target.dataset.finder;
      if (n !== undefined) window.api.showInFinder(sec.items[n].paths[0]);
    };
  }

  v.innerHTML = `<div class="hw"><div class="hhead"><h2>${title}</h2>${back}</div><div class="hlist">${rows || '<div class="hrow">Nichts gefunden.</div>'}</div></div>`;
  $('#hBack').onclick = () => { health.list = null; v.onclick = null; renderHealth(); };
}

async function refreshHealth() {
  health.data = await window.api.health();
  renderHealth();
}

window.api.on('health-progress', ({ done, total }) => {
  const s = $('#healthStatus');
  if (s) s.textContent = `Analysiere Bibliothek … ${done}/${total}`;
});

function showView(name) {
  const isHealth = name === 'health';
  document.body.classList.toggle('health', isHealth);
  $('#libView').classList.toggle('hidden', isHealth);
  $('#healthView').classList.toggle('hidden', !isHealth);
  $('#tabLib').classList.toggle('active', !isHealth);
  $('#tabHealth').classList.toggle('active', isHealth);
  if (isHealth) { health.list = null; renderHealth(); refreshHealth(); }
}
$('#tabLib').onclick = () => showView('library');
$('#tabHealth').onclick = () => showView('health');

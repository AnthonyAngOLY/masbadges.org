// Store product catalogue — admin surface for Finance Officer + sysadmin.
// Replaces the Store products tab in Settings. Full-page card grid modeled
// on the reference: a persistent "+ New product" form-card first, followed
// by the catalogue as draggable cards.
//
// Drag reorder uses native HTML5 DnD (no library dependency). On drop, the
// updated order is persisted via reorder_store_products(uuid[]). Optimistic:
// UI reorders immediately; error rolls back with a message.
//
// Product create/edit/delete go through direct table writes gated by the
// RLS policies extended in 20260717100000_store_products_admin_extension.sql.
// Image upload writes to the store-products bucket via the storage API.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import Icon from '../components/Icon';
import '../styles/admin.css';

interface Product {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: string;
  unit_price: number;
  image_paths: string[];
  stock_qty: number | null;
  sort_order: number;
  active: boolean;
}

type Load = 'loading' | 'ready' | 'error';

const CATEGORY_OPTIONS = [
  { value: 'branding', label: 'Branding' },
  { value: 'teaching_materials', label: 'Teaching Materials' },
];

const CSS = `
.mas-catalog-page { max-width: none; }
.mas-catalog-head {
  background: #fff; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 10px;
  padding: 1rem 1.2rem; margin-bottom: 1.2rem;
}
.mas-catalog-head h2 { margin: 0 0 0.35rem; color: var(--mas-navy, #1E2752); font-size: 1.05rem; }
.mas-catalog-head p { margin: 0; color: var(--mas-muted, #5b6472); font-size: 0.88rem; line-height: 1.45; }

.mas-catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 1rem;
}

.mas-newcard {
  background: #fff; border: 1.5px dashed var(--mas-line, #e3e9f3); border-radius: 10px;
  padding: 0.9rem; display: flex; flex-direction: column; gap: 0.6rem;
  min-height: 22rem;
}
.mas-newcard-title { font-weight: 600; color: var(--mas-navy, #1E2752); font-size: 0.95rem; margin: 0 0 0.2rem; display: flex; align-items: center; gap: 0.3rem; }
.mas-newcard input, .mas-newcard textarea, .mas-newcard select {
  font: inherit; padding: 0.4rem 0.55rem; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px; width: 100%;
}
.mas-newcard textarea { resize: vertical; min-height: 3rem; }
.mas-newcard-photo {
  aspect-ratio: 1 / 1; background: #f5f7fb; border: 1px dashed var(--mas-line, #e3e9f3); border-radius: 8px;
  display: flex; align-items: center; justify-content: center; color: var(--mas-muted, #5b6472);
  cursor: pointer; overflow: hidden; position: relative;
}
.mas-newcard-photo img { width: 100%; height: 100%; object-fit: cover; }
.mas-newcard-photo:hover { background: #eef1f8; }
.mas-newcard-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
.mas-newcard-submit {
  background: var(--mas-navy, #1E2752); color: #fff; border: 0;
  padding: 0.5rem; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer;
}
.mas-newcard-submit:disabled { background: var(--mas-muted, #5b6472); cursor: not-allowed; }

.mas-catalog-count {
  font-weight: 600; color: var(--mas-navy, #1E2752); font-size: 0.95rem; margin: 1.5rem 0 0.6rem;
}

.mas-pcard {
  background: #fff; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 10px;
  overflow: hidden; display: flex; flex-direction: column;
  transition: box-shadow 0.15s, transform 0.15s;
}
.mas-pcard.is-dragging { opacity: 0.4; }
.mas-pcard.is-drop-target { border-color: var(--mas-gold, #F9C610); border-width: 2px; }
.mas-pcard:hover { box-shadow: 0 4px 14px rgba(30, 39, 82, 0.08); }
.mas-pcard-photo {
  aspect-ratio: 1 / 1; background: #f5f7fb; display: flex; align-items: center; justify-content: center;
  color: var(--mas-muted, #5b6472); position: relative; overflow: hidden;
}
.mas-pcard-photo img { width: 100%; height: 100%; object-fit: cover; }
.mas-pcard-drag {
  position: absolute; top: 0.5rem; left: 0.5rem;
  background: rgba(255,255,255,0.9); border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px;
  padding: 0.2rem 0.4rem; cursor: grab; color: var(--mas-muted, #5b6472);
  font-family: ui-monospace, monospace; font-size: 0.9rem; line-height: 1;
  user-select: none;
}
.mas-pcard-drag:active { cursor: grabbing; }
.mas-pcard-body { padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.2rem; flex: 1; }
.mas-pcard-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.mas-pcard-name { font-weight: 600; color: var(--mas-navy, #1E2752); font-size: 0.95rem; margin: 0; }
.mas-pcard-price { font-weight: 700; color: var(--mas-navy, #1E2752); font-size: 0.95rem; white-space: nowrap; }
.mas-pcard-sku { color: var(--mas-muted, #5b6472); font-size: 0.75rem; font-family: ui-monospace, monospace; }
.mas-pcard-desc { color: var(--mas-muted, #5b6472); font-size: 0.82rem; margin: 0.2rem 0 0; line-height: 1.35; }
.mas-pcard-badge {
  display: inline-block; font-size: 0.68rem; padding: 0.1rem 0.45rem; border-radius: 999px;
  text-transform: uppercase; letter-spacing: 0.05em; background: #eef1f8; color: var(--mas-navy, #1E2752);
  margin-top: 0.4rem;
}
.mas-pcard-badge.is-inactive { background: #f3d5d6; color: var(--mas-red, #C62026); }
.mas-pcard-actions { display: flex; gap: 0.4rem; padding: 0 0.9rem 0.9rem; }
.mas-pcard-actions button {
  flex: 1; padding: 0.4rem; border: 1px solid var(--mas-line, #e3e9f3);
  border-radius: 6px; background: #fff; font: inherit; font-size: 0.85rem; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem;
  color: var(--mas-navy, #1E2752);
}
.mas-pcard-actions button:hover { background: #eef1f8; }
.mas-pcard-actions .is-danger { color: var(--mas-red, #C62026); }
.mas-pcard-actions .is-danger:hover { background: #f7e3e4; }

.mas-catalog-msg {
  padding: 0.6rem 0.8rem; border-radius: 6px; font-size: 0.88rem; margin: 0.6rem 0;
}
.mas-catalog-msg.is-good { background: #dff3e6; color: #0d5928; }
.mas-catalog-msg.is-bad  { background: #f7e3e4; color: var(--mas-red, #C62026); }

.mas-edit-drawer {
  background: #fff; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 10px;
  padding: 1rem; margin: 0.6rem 0 1.2rem;
}
.mas-edit-drawer h3 { margin: 0 0 0.6rem; color: var(--mas-navy, #1E2752); font-size: 0.95rem; }
.mas-edit-drawer .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.5rem; }
.mas-edit-drawer .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; margin-bottom: 0.5rem; }
.mas-edit-drawer label { display: flex; flex-direction: column; font-size: 0.78rem; color: var(--mas-muted, #5b6472); gap: 0.15rem; }
.mas-edit-drawer input, .mas-edit-drawer textarea, .mas-edit-drawer select {
  font: inherit; padding: 0.4rem 0.55rem; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px;
}
.mas-edit-drawer .thumbs { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.4rem 0; }
.mas-edit-drawer .thumb {
  position: relative; width: 5rem; height: 5rem;
  border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px; overflow: hidden;
}
.mas-edit-drawer .thumb.is-primary { outline: 2px solid var(--mas-gold, #F9C610); }
.mas-edit-drawer .thumb img { width: 100%; height: 100%; object-fit: cover; }
.mas-edit-drawer .thumb button {
  position: absolute; top: 0.15rem; right: 0.15rem;
  background: rgba(0,0,0,0.6); color: #fff; border: 0;
  width: 1.2rem; height: 1.2rem; border-radius: 999px; cursor: pointer; font-size: 0.75rem; line-height: 1;
}
.mas-edit-drawer .footer { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.6rem; }
.mas-edit-drawer .footer .grow { flex: 1; }
`;

function money(n: number | string | null | undefined): string {
  return `RM ${Number(n ?? 0).toFixed(2)}`;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
function imageUrl(path: string | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('store-products').getPublicUrl(path).data.publicUrl;
}

export default function StoreProducts() {
  const [rows, setRows] = useState<Product[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // "+ New product" inline card state
  const [nName, setNName] = useState('');
  const [nSku, setNSku] = useState('');
  const [nPrice, setNPrice] = useState('');
  const [nDesc, setNDesc] = useState('');
  const [nCategory, setNCategory] = useState('branding');
  const [nPhoto, setNPhoto] = useState<File | null>(null);
  const [nPhotoUrl, setNPhotoUrl] = useState<string | null>(null);
  const [nBusy, setNBusy] = useState(false);

  // edit drawer state
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [eSku, setESku] = useState('');
  const [ePrice, setEPrice] = useState('');
  const [eDesc, setEDesc] = useState('');
  const [eCategory, setECategory] = useState('branding');
  const [eStock, setEStock] = useState('');
  const [eActive, setEActive] = useState(true);
  const [eBusy, setEBusy] = useState(false);
  const [eUploading, setEUploading] = useState(false);

  // drag state
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const preDragOrder = useRef<Product[]>([]);

  const fetchRows = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase
      .from('store_products')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name');
    if (error) { setLoad('error'); return; }
    setRows((data ?? []) as Product[]);
    setLoad('ready');
  }, []);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  // ---------- CREATE ----------
  function onNewPhoto(f: File | null) {
    setNPhoto(f);
    if (nPhotoUrl) URL.revokeObjectURL(nPhotoUrl);
    setNPhotoUrl(f ? URL.createObjectURL(f) : null);
  }

  async function createProduct() {
    setMsg(null);
    const price = Number(nPrice);
    if (!nName.trim() || !(price >= 0) || Number.isNaN(price)) {
      setMsg({ ok: false, text: 'Product name and a non-negative price are required.' });
      return;
    }
    setNBusy(true);

    // 1. Generate a code from the name; ensure uniqueness by appending time if taken
    let code = slug(nName);
    if (!code) code = 'product_' + Date.now();
    const dup = rows.find((r) => r.code === code);
    if (dup) code = `${code}_${Date.now().toString(36).slice(-4)}`;

    // 2. Insert product row
    const nextSort = rows.length
      ? Math.max(...rows.map((r) => r.sort_order ?? 0)) + 10
      : 10;
    const ins = await supabase.from('store_products').insert({
      code,
      name: nName.trim(),
      sku: nSku.trim() || null,
      description: nDesc.trim() || null,
      category: nCategory,
      unit_price: price,
      active: true,
      sort_order: nextSort,
      image_paths: [],
    }).select('id').single();

    if (ins.error) { setNBusy(false); setMsg({ ok: false, text: ins.error.message }); return; }

    // 3. If photo picked, upload it and attach as primary
    if (nPhoto && ins.data) {
      const clean = nPhoto.name.replace(/[^A-Za-z0-9._-]/g, '_');
      const path = `products/${ins.data.id}/${Date.now()}_${clean}`;
      const up = await supabase.storage.from('store-products').upload(path, nPhoto, { upsert: false });
      if (!up.error) {
        await supabase.from('store_products')
          .update({ image_paths: [path] })
          .eq('id', ins.data.id);
      }
    }

    // 4. Clear form
    setNName(''); setNSku(''); setNPrice(''); setNDesc(''); setNCategory('branding');
    onNewPhoto(null);
    setNBusy(false);
    setMsg({ ok: true, text: `Added "${nName.trim()}" to the catalogue.` });
    fetchRows();
  }

  // ---------- EDIT ----------
  function openEdit(p: Product) {
    setEditId(p.id);
    // scroll the drawer into view once React renders it
    setTimeout(() => document.getElementById('mas-store-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    setEName(p.name);
    setESku(p.sku ?? '');
    setEPrice(String(p.unit_price));
    setEDesc(p.description ?? '');
    setECategory(p.category);
    setEStock(p.stock_qty == null ? '' : String(p.stock_qty));
    setEActive(p.active);
    setMsg(null);
  }
  function closeEdit() { setEditId(null); }

  async function saveEdit() {
    if (!editId) return;
    const price = Number(ePrice);
    if (!eName.trim() || !(price >= 0)) {
      setMsg({ ok: false, text: 'Name and non-negative price are required.' });
      return;
    }
    setEBusy(true);
    const { error } = await supabase.from('store_products').update({
      name: eName.trim(),
      sku: eSku.trim() || null,
      description: eDesc.trim() || null,
      category: eCategory,
      unit_price: price,
      stock_qty: eStock.trim() === '' ? null : Number(eStock),
      active: eActive,
    }).eq('id', editId);
    setEBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setMsg({ ok: true, text: 'Saved.' });
    fetchRows();
  }

  async function uploadEditImage(f: File) {
    if (!editId) return;
    const p = rows.find((r) => r.id === editId);
    if (!p) return;
    setEUploading(true); setMsg(null);
    const clean = f.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `products/${p.id}/${Date.now()}_${clean}`;
    const up = await supabase.storage.from('store-products').upload(path, f, { upsert: false });
    if (up.error) { setEUploading(false); setMsg({ ok: false, text: up.error.message }); return; }
    const nextPaths = [...(p.image_paths ?? []), path];
    await supabase.from('store_products').update({ image_paths: nextPaths }).eq('id', p.id);
    setEUploading(false);
    fetchRows();
  }
  async function removeImage(path: string) {
    if (!editId) return;
    const p = rows.find((r) => r.id === editId);
    if (!p) return;
    const rest = (p.image_paths ?? []).filter((x) => x !== path);
    await supabase.from('store_products').update({ image_paths: rest }).eq('id', p.id);
    await supabase.storage.from('store-products').remove([path]);
    fetchRows();
  }
  async function makePrimary(path: string) {
    if (!editId) return;
    const p = rows.find((r) => r.id === editId);
    if (!p) return;
    const rest = (p.image_paths ?? []).filter((x) => x !== path);
    await supabase.from('store_products').update({ image_paths: [path, ...rest] }).eq('id', p.id);
    fetchRows();
  }

  // ---------- DELETE ----------
  async function deleteProduct(p: Product) {
    if (!window.confirm(`Delete "${p.name}"? Existing orders keep their snapshotted line items; this only removes the product from the catalogue.`)) return;
    const { error } = await supabase.from('store_products').delete().eq('id', p.id);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setMsg({ ok: true, text: `Deleted "${p.name}".` });
    if (editId === p.id) setEditId(null);
    fetchRows();
  }

  // ---------- DRAG REORDER ----------
  function onDragStart(id: string) {
    preDragOrder.current = rows.slice();
    setDragging(id);
  }
  function onDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (!dragging || dragging === id) return;
    setDropTarget(id);
  }
  function onDragLeave() {
    setDropTarget(null);
  }
  async function onDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragging || dragging === targetId) {
      setDragging(null); setDropTarget(null);
      return;
    }
    const fromIdx = rows.findIndex((r) => r.id === dragging);
    const toIdx = rows.findIndex((r) => r.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDragging(null); setDropTarget(null);
      return;
    }
    const next = rows.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setRows(next);  // optimistic
    setDragging(null); setDropTarget(null);

    const { error } = await supabase.rpc('reorder_store_products', {
      _ordered_ids: next.map((r) => r.id),
    });
    if (error) {
      setRows(preDragOrder.current);
      setMsg({ ok: false, text: `Reorder failed: ${error.message}` });
    }
  }

  const editingProduct = useMemo(
    () => (editId ? rows.find((r) => r.id === editId) : null),
    [rows, editId],
  );

  return (
    <section className="mas-page mas-catalog-page">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Billing · Store</p>
        <h1>Product catalogue</h1>
        <p className="mas-lede">
          Curate the items sold in the Store. Add a photo, price, and description
          &mdash; buyers see exactly what appears on each card. Drag cards by their
          handle to reorder within the catalogue.
        </p>
      </header>

      {editingProduct && (
        <div className="mas-edit-drawer" id="mas-store-editor">
          <h3>Edit — {editingProduct.name}</h3>
          <div className="row">
            <label>Name<input type="text" value={eName} onChange={(e) => setEName(e.target.value)} /></label>
            <label>SKU<input type="text" value={eSku} onChange={(e) => setESku(e.target.value)} /></label>
          </div>
          <div className="row3">
            <label>Price (RM)<input type="number" step="0.01" value={ePrice} onChange={(e) => setEPrice(e.target.value)} /></label>
            <label>Category
              <select value={eCategory} onChange={(e) => setECategory(e.target.value)}>
                {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label>Stock (blank = untracked)<input type="number" value={eStock} onChange={(e) => setEStock(e.target.value)} /></label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', marginBottom: '0.5rem', fontSize: '0.78rem', color: 'var(--mas-muted,#5b6472)' }}>
            Description
            <textarea rows={2} value={eDesc} onChange={(e) => setEDesc(e.target.value)} />
          </label>

          <p style={{ fontSize: '0.78rem', color: 'var(--mas-muted,#5b6472)', margin: '0.6rem 0 0.3rem' }}>
            Images — first is the buyer-facing primary
          </p>
          <div className="thumbs">
            {(editingProduct.image_paths ?? []).map((path, i) => (
              <div key={path} className={`thumb${i === 0 ? ' is-primary' : ''}`}>
                <img src={imageUrl(path) ?? ''} alt="" />
                <button title="Remove" onClick={() => removeImage(path)}>×</button>
                {i !== 0 && (
                  <button title="Make primary" onClick={() => makePrimary(path)}
                    style={{ right: 'auto', left: '0.15rem', background: 'rgba(30,39,82,0.85)' }}>★</button>
                )}
              </div>
            ))}
            <label className="thumb" style={{ borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--mas-muted,#5b6472)', background: '#fff' }}>
              {eUploading ? '…' : '+'}
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={eUploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEditImage(f); e.target.value = ''; }} />
            </label>
          </div>

          <div className="footer">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--mas-navy,#1E2752)' }}>
              <input type="checkbox" checked={eActive} onChange={(e) => setEActive(e.target.checked)} />
              Active (visible in the buyer store)
            </label>
            <span className="grow" />
            <button className="mas-btn-ghost mas-btn-compact" onClick={closeEdit}>Cancel</button>
            <button className="mas-btn-primary mas-btn-compact" onClick={saveEdit} disabled={eBusy}>
              {eBusy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className={`mas-catalog-msg ${msg.ok ? 'is-good' : 'is-bad'}`}>{msg.text}</div>
      )}

      <div className="mas-catalog-grid">
        {/* + New product form card */}
        <div className="mas-newcard">
          <p className="mas-newcard-title"><Icon name="userPlus" /> New product</p>
          <label className="mas-newcard-photo" htmlFor="new-photo">
            {nPhotoUrl
              ? <img src={nPhotoUrl} alt="preview" />
              : <span>+ Add photo</span>}
            <input id="new-photo" type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => onNewPhoto(e.target.files?.[0] ?? null)} />
          </label>
          <input type="text" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Product name" />
          <div className="mas-newcard-row">
            <input type="text" value={nSku} onChange={(e) => setNSku(e.target.value)} placeholder="SKU (optional)" />
            <input type="number" step="0.01" value={nPrice} onChange={(e) => setNPrice(e.target.value)} placeholder="Price RM" />
          </div>
          <select value={nCategory} onChange={(e) => setNCategory(e.target.value)}>
            {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <textarea rows={2} value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder="Description (optional)" />
          <button className="mas-newcard-submit" onClick={createProduct} disabled={nBusy}>
            {nBusy ? 'Adding…' : 'Add Product'}
          </button>
        </div>

        {/* Existing product cards */}
        {load === 'loading' && <p className="mas-status" style={{ gridColumn: '1 / -1' }}>Loading catalogue…</p>}
        {load === 'error'   && <p className="mas-status mas-status-bad" style={{ gridColumn: '1 / -1' }}>Couldn’t load products.</p>}
        {load === 'ready' && rows.map((p) => {
          const primary = imageUrl(p.image_paths?.[0]);
          const isEditing = editId === p.id;
          const cls = 'mas-pcard'
            + (dragging === p.id ? ' is-dragging' : '')
            + (dropTarget === p.id ? ' is-drop-target' : '');
          return (
            <div key={p.id}
              className={cls}
              draggable
              onDragStart={() => onDragStart(p.id)}
              onDragOver={(e) => onDragOver(e, p.id)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, p.id)}
              onDragEnd={() => { setDragging(null); setDropTarget(null); }}
            >
              <div className="mas-pcard-photo">
                {primary ? <img src={primary} alt={p.name} loading="lazy" /> : <span>no photo</span>}
                <span className="mas-pcard-drag" title="Drag to reorder">⋮⋮</span>
              </div>
              <div className="mas-pcard-body">
                <div className="mas-pcard-head">
                  <p className="mas-pcard-name">{p.name}</p>
                  <span className="mas-pcard-price">{money(p.unit_price)}</span>
                </div>
                {p.sku && <div className="mas-pcard-sku">SKU: {p.sku}</div>}
                {p.description && <p className="mas-pcard-desc">{p.description}</p>}
                {!p.active && <span className="mas-pcard-badge is-inactive">Inactive</span>}
              </div>
              <div className="mas-pcard-actions">
                <button onClick={() => (isEditing ? closeEdit() : openEdit(p))}>
                  <Icon name="settings" /> {isEditing ? 'Close' : 'Edit'}
                </button>
                <button className="is-danger" onClick={() => deleteProduct(p)}>Delete</button>
              </div>
            </div>
          );
        })}

      </div>
    </section>
  );
}

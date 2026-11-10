// Store — storefront catalogue for examiners, instructors, and partner centres.
//
// This rewrite fixes two silent failures:
//   • the previous file called list_store_products / place_store_order,
//     neither of which exists in the current backend — products load direct
//     via RLS, checkout goes through submit_store_order.
//   • images were never rendered. The Settings module uploads to the
//     store-products bucket and stores paths in store_products.image_paths;
//     this file reads image_paths[0] and resolves it via the storage helper.
//
// Layout: 4-column card grid on desktop, 2 on tablet, 1 on mobile. Category
// filter and search. Sticky cart drawer with structured checkout matching
// submit_store_order's argument list (recipient, phone, email, address_line1,
// address_line2, city, state, postcode, note).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

interface Product {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  unit_price: number;
  image_paths: string[] | null;
  stock_qty: number | null;
  active: boolean;
}

interface MyOrder {
  order_id: string;
  order_no: string;
  status: string;
  created_at: string;
  total_amount: number | null;
  invoice_no: string | null;
  invoice_amount: number | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  tracking: string | null;
  recipient_name: string | null;
  city: string | null;
  state: string | null;
  items: { label: string; qty: number; unit_price: number; line_total: number }[] | null;
}

type Cart = Record<string, number>;
type Load = 'loading' | 'ready' | 'error';

const CSS = `
.mas-storefront { display: grid; grid-template-columns: 1fr 320px; gap: 1.5rem; align-items: start; }
@media (max-width: 960px) { .mas-storefront { grid-template-columns: 1fr; } }

.mas-store-filters { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; }
.mas-store-filters .mas-input { max-width: 22rem; }
.mas-store-count { color: var(--mas-muted, #5b6472); font-size: 0.85rem; margin-left: auto; }
.mas-store-chip {
  font: inherit; font-size: 0.82rem; padding: 0.3rem 0.75rem; border-radius: 999px;
  border: 1px solid var(--mas-line, #e3e9f3); background: #fff; cursor: pointer; color: var(--mas-navy, #1E2752);
}
.mas-store-chip.is-active { background: var(--mas-navy, #1E2752); color: #fff; border-color: var(--mas-navy, #1E2752); }

.mas-store-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}
@media (max-width: 1200px) { .mas-store-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 900px)  { .mas-store-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px)  { .mas-store-grid { grid-template-columns: 1fr; } }

.mas-store-card {
  background: #fff; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 10px;
  display: flex; flex-direction: column; overflow: hidden;
  transition: box-shadow 0.15s, transform 0.15s;
}
.mas-store-card:hover { box-shadow: 0 6px 24px rgba(30, 39, 82, 0.09); transform: translateY(-2px); }
.mas-store-media {
  aspect-ratio: 1 / 1; background: #f5f7fb; display: flex; align-items: center; justify-content: center;
  overflow: hidden; position: relative;
}
.mas-store-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mas-store-media-placeholder { color: var(--mas-muted, #5b6472); font-size: 0.85rem; text-align: center; padding: 1rem; }
.mas-store-cat {
  position: absolute; top: 0.5rem; left: 0.5rem;
  background: rgba(30, 39, 82, 0.85); color: #fff;
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 0.2rem 0.55rem; border-radius: 4px;
}
.mas-store-stock {
  position: absolute; top: 0.5rem; right: 0.5rem;
  background: #fff; color: var(--mas-navy, #1E2752);
  font-size: 0.72rem; padding: 0.2rem 0.5rem; border-radius: 4px;
  border: 1px solid var(--mas-line, #e3e9f3);
}
.mas-store-stock.is-low { color: var(--mas-red, #C62026); border-color: var(--mas-red, #C62026); }
.mas-store-stock.is-out { background: var(--mas-red, #C62026); color: #fff; border-color: var(--mas-red, #C62026); }
.mas-store-body { padding: 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; flex: 1; }
.mas-store-name { font-size: 1rem; font-weight: 600; color: var(--mas-navy, #1E2752); line-height: 1.25; margin: 0; }
.mas-store-desc { color: var(--mas-muted, #5b6472); font-size: 0.85rem; line-height: 1.4; margin: 0; }
.mas-store-price { font-size: 1.1rem; font-weight: 700; color: var(--mas-navy, #1E2752); margin-top: auto; }
.mas-store-actions { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.5rem; }
.mas-store-qty { display: flex; align-items: center; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px; overflow: hidden; }
.mas-store-qty button {
  background: #fff; border: 0; padding: 0.35rem 0.7rem; cursor: pointer;
  color: var(--mas-navy, #1E2752); font: inherit; font-weight: 600;
}
.mas-store-qty button:disabled { color: var(--mas-muted, #5b6472); cursor: not-allowed; }
.mas-store-qty span { padding: 0 0.5rem; min-width: 1.5rem; text-align: center; font-weight: 600; }
.mas-store-add {
  flex: 1; background: var(--mas-navy, #1E2752); color: #fff; border: 0;
  padding: 0.4rem 0.8rem; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer;
}
.mas-store-add:disabled { background: var(--mas-muted, #5b6472); cursor: not-allowed; }
.mas-store-in-cart {
  color: var(--mas-muted, #5b6472); font-size: 0.78rem; text-align: center; margin-top: 0.3rem;
}

.mas-cart {
  position: sticky; top: 1rem; background: #fff; border: 1px solid var(--mas-line, #e3e9f3);
  border-radius: 10px; padding: 1rem; max-height: calc(100vh - 2rem); overflow: auto;
}
.mas-cart h2 { font-size: 1rem; margin: 0 0 0.6rem; color: var(--mas-navy, #1E2752); }
.mas-cart-empty { color: var(--mas-muted, #5b6472); font-size: 0.9rem; }
.mas-cart-line { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.88rem; padding: 0.4rem 0; border-bottom: 1px dashed var(--mas-line, #e3e9f3); }
.mas-cart-line:last-of-type { border-bottom: 0; }
.mas-cart-line-name { color: var(--mas-navy, #1E2752); }
.mas-cart-line-qty { color: var(--mas-muted, #5b6472); font-size: 0.8rem; }
.mas-cart-line-total { font-weight: 600; color: var(--mas-navy, #1E2752); white-space: nowrap; }
.mas-cart-remove { background: none; border: 0; color: var(--mas-red, #C62026); cursor: pointer; font-size: 0.75rem; padding: 0; }
.mas-cart-total { display: flex; justify-content: space-between; font-weight: 700; padding-top: 0.6rem; border-top: 2px solid var(--mas-navy, #1E2752); margin-top: 0.5rem; color: var(--mas-navy, #1E2752); }

.mas-checkout { margin-top: 0.8rem; }
.mas-checkout h3 { font-size: 0.9rem; margin: 0.8rem 0 0.4rem; color: var(--mas-navy, #1E2752); }
.mas-checkout label { display: flex; flex-direction: column; font-size: 0.78rem; color: var(--mas-muted, #5b6472); margin-bottom: 0.4rem; }
.mas-checkout label input, .mas-checkout label select, .mas-checkout label textarea {
  font: inherit; padding: 0.4rem 0.55rem; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 6px; margin-top: 0.15rem;
}
.mas-checkout-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
.mas-checkout-submit {
  width: 100%; background: var(--mas-navy, #1E2752); color: #fff; border: 0;
  padding: 0.65rem; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer; margin-top: 0.6rem;
}
.mas-checkout-submit:disabled { background: var(--mas-muted, #5b6472); cursor: not-allowed; }

.mas-store-orders { margin-top: 2rem; }
.mas-store-orders h2 { color: var(--mas-navy, #1E2752); font-size: 1.1rem; margin: 0 0 0.6rem; }
.mas-store-order-card {
  background: #fff; border: 1px solid var(--mas-line, #e3e9f3); border-radius: 8px;
  padding: 0.8rem 1rem; margin-bottom: 0.6rem;
}
.mas-store-order-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
.mas-store-order-no { font-weight: 700; color: var(--mas-navy, #1E2752); }
.mas-store-order-date { color: var(--mas-muted, #5b6472); font-size: 0.85rem; }
.mas-store-order-status {
  font-size: 0.78rem; padding: 0.2rem 0.6rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em;
  background: #eef1f8; color: var(--mas-navy, #1E2752);
}
.mas-store-order-status.is-invoiced { background: #fef4d9; color: #7a5b00; }
.mas-store-order-status.is-paid     { background: #dff3e6; color: #0d5928; }
.mas-store-order-status.is-shipped  { background: var(--mas-navy, #1E2752); color: #fff; }
.mas-store-order-status.is-cancelled{ background: #f3d5d6; color: var(--mas-red, #C62026); }
.mas-store-order-items { color: var(--mas-muted, #5b6472); font-size: 0.88rem; margin: 0.4rem 0 0; }
.mas-store-order-meta  { color: var(--mas-muted, #5b6472); font-size: 0.82rem; margin: 0.3rem 0 0; }
.mas-store-order-tracking { color: var(--mas-navy, #1E2752); font-weight: 600; }

.mas-lightbox {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(20, 26, 51, 0.92);
  display: flex; align-items: center; justify-content: center;
  padding: 2rem; cursor: zoom-out;
  animation: mas-lightbox-in 0.15s ease-out;
}
@keyframes mas-lightbox-in { from { opacity: 0; } to { opacity: 1; } }
.mas-lightbox img {
  max-width: 100%; max-height: 100%; object-fit: contain;
  border-radius: 6px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  cursor: default;
}
.mas-lightbox-close {
  position: absolute; top: 1rem; right: 1rem;
  background: rgba(255,255,255,0.15); color: #fff; border: 0;
  width: 2.4rem; height: 2.4rem; border-radius: 999px;
  font-size: 1.4rem; cursor: pointer; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.mas-lightbox-close:hover { background: rgba(255,255,255,0.25); }
.mas-store-media { cursor: zoom-in; }
`;

function money(n: number | string | null | undefined): string {
  return `RM ${Number(n ?? 0).toFixed(2)}`;
}
function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}
function pretty(s: string | null): string {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
function imageUrl(path: string | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('store-products').getPublicUrl(path).data.publicUrl;
}
function statusChipClass(s: string): string {
  return `mas-store-order-status is-${s}`;
}

export default function Store() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [cat, setCat] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Cart>({});

  // shipping form
  const [recipient, setRecipient] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [postcode, setPostcode] = useState('');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // Close lightbox on Esc.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const fetchProducts = useCallback(async () => {
    setLoad('loading');
    const { data, error } = await supabase
      .from('store_products')
      .select('id, code, name, description, category, unit_price, image_paths, stock_qty, active')
      .eq('active', true)
      .order('category')
      .order('name');
    if (error) { setLoad('error'); return; }
    setProducts((data ?? []) as Product[]);
    setLoad('ready');
  }, []);

  const [ordersFailed, setOrdersFailed] = useState(false);
  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_my_store_orders');
    // "No orders yet." is a strong claim to make at someone who has ordered.
    setOrdersFailed(Boolean(error));
    if (error) { setOrders([]); return; }
    setOrders((data ?? []) as MyOrder[]);
  }, []);

  useEffect(() => {
    fetchProducts();
    fetchOrders();
    supabase.rpc('list_my_states').then(({ data }) => {
      if (data) setStates((data as unknown[]).map((x) => String((x as Record<string, unknown>).list_my_states ?? x)));
    });
    // prefill from last order
    supabase.rpc('list_my_store_orders').then(({ data }) => {
      const rows = (data ?? []) as MyOrder[];
      const last = rows[0];
      if (last?.recipient_name) setRecipient(last.recipient_name);
    });
  }, [fetchProducts, fetchOrders]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category));
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) =>
      (cat === 'all' || p.category === cat) &&
      (!q || p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q))
    );
  }, [products, cat, query]);

  function addToCart(p: Product) {
    const current = cart[p.id] ?? 0;
    if (p.stock_qty != null && current + 1 > p.stock_qty) return;
    setCart((c) => ({ ...c, [p.id]: current + 1 }));
    setMsg(null);
  }
  function setQty(id: string, qty: number) {
    const p = products.find((x) => x.id === id);
    let clamped = Math.max(0, qty);
    if (p?.stock_qty != null) clamped = Math.min(clamped, p.stock_qty);
    setCart((c) => {
      const next = { ...c };
      if (clamped === 0) delete next[id]; else next[id] = clamped;
      return next;
    });
    setMsg(null);
  }
  function removeFromCart(id: string) {
    setCart((c) => { const n = { ...c }; delete n[id]; return n; });
  }

  const lines = useMemo(
    () => products
      .filter((p) => (cart[p.id] ?? 0) > 0)
      .map((p) => ({ p, qty: cart[p.id], total: p.unit_price * cart[p.id] })),
    [products, cart],
  );
  const cartTotal = useMemo(() => lines.reduce((s, l) => s + l.total, 0), [lines]);
  const cartCount = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);

  async function submit() {
    setMsg(null);
    if (lines.length === 0) {
      setMsg({ ok: false, text: 'Your cart is empty.' }); return;
    }
    if (!recipient.trim() || !phone.trim() || !email.trim() ||
        !addr1.trim() || !city.trim() || !stateCode || !postcode.trim()) {
      setMsg({ ok: false, text: 'Shipping details are incomplete.' }); return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('submit_store_order', {
      _items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })),
      _recipient_name: recipient.trim(),
      _phone: phone.trim(),
      _email: email.trim(),
      _address_line1: addr1.trim(),
      _address_line2: addr2.trim() || null,
      _city: city.trim(),
      _state: stateCode,
      _postcode: postcode.trim(),
      _note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setMsg({ ok: true, text: 'Order placed. The finance office will send an invoice shortly.' });
    setCart({}); setAddr2(''); setNote('');
    fetchProducts();
    fetchOrders();
  }

  return (
    <section className="mas-page mas-page-wide">
      <style>{CSS}</style>
      <header className="mas-page-head">
        <p className="mas-eyebrow">Store</p>
        <h1>Branding &amp; teaching materials</h1>
        <p className="mas-lede">
          Order programme materials for your centre or classes. Place your order and
          the finance office will issue an invoice; goods ship once payment is received.
        </p>
      </header>

      <div className="mas-storefront">
        <div>
          <div className="mas-store-filters">
            <button className={`mas-store-chip${cat === 'all' ? ' is-active' : ''}`} onClick={() => setCat('all')}>
              All ({products.length})
            </button>
            {categories.map((c) => (
              <button key={c} className={`mas-store-chip${cat === c ? ' is-active' : ''}`} onClick={() => setCat(c)}>
                {pretty(c)} ({products.filter((p) => p.category === c).length})
              </button>
            ))}
            <input
              className="mas-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
            />
            {load === 'ready' && <span className="mas-store-count">{filtered.length} shown</span>}
          </div>

          {load === 'loading' && <p className="mas-status">Loading catalogue…</p>}
          {load === 'error'   && <p className="mas-status mas-status-bad">Couldn’t load products.</p>}
          {load === 'ready' && filtered.length === 0 && (
            <p className="mas-status">No products match your filters.</p>
          )}

          {load === 'ready' && filtered.length > 0 && (
            <div className="mas-store-grid">
              {filtered.map((p) => {
                const inCart = cart[p.id] ?? 0;
                const primary = imageUrl(p.image_paths?.[0]);
                const outOfStock = p.stock_qty != null && p.stock_qty <= 0;
                const lowStock = p.stock_qty != null && p.stock_qty > 0 && p.stock_qty <= 5;
                return (
                  <div key={p.id} className="mas-store-card">
                    <div className="mas-store-media"
                      onClick={() => primary && setLightbox({ src: primary, alt: p.name })}
                      role={primary ? 'button' : undefined}
                      tabIndex={primary ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (primary && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          setLightbox({ src: primary, alt: p.name });
                        }
                      }}>
                      {primary
                        ? <img src={primary} alt={p.name} loading="lazy" />
                        : <span className="mas-store-media-placeholder">No image</span>}
                      <span className="mas-store-cat">{pretty(p.category)}</span>
                      {outOfStock && <span className="mas-store-stock is-out">Out of stock</span>}
                      {!outOfStock && lowStock && <span className="mas-store-stock is-low">Only {p.stock_qty} left</span>}
                    </div>
                    <div className="mas-store-body">
                      <h3 className="mas-store-name">{p.name}</h3>
                      {p.description && <p className="mas-store-desc">{p.description}</p>}
                      <p className="mas-store-price">{money(p.unit_price)}</p>
                      <div className="mas-store-actions">
                        {inCart > 0 ? (
                          <div className="mas-store-qty" role="group" aria-label="Quantity">
                            <button onClick={() => setQty(p.id, inCart - 1)} aria-label="Decrease">−</button>
                            <span>{inCart}</span>
                            <button
                              onClick={() => setQty(p.id, inCart + 1)}
                              disabled={p.stock_qty != null && inCart >= p.stock_qty}
                              aria-label="Increase">+</button>
                          </div>
                        ) : (
                          <button
                            className="mas-store-add"
                            onClick={() => addToCart(p)}
                            disabled={outOfStock}>
                            {outOfStock ? 'Unavailable' : 'Add to cart'}
                          </button>
                        )}
                      </div>
                      {inCart > 0 && <p className="mas-store-in-cart">{inCart} in cart</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="mas-cart" aria-label="Cart">
          <h2>Your cart {cartCount > 0 && `(${cartCount})`}</h2>

          {lines.length === 0 ? (
            <p className="mas-cart-empty">Your cart is empty. Add items from the catalogue.</p>
          ) : (
            <>
              {lines.map((l) => (
                <div key={l.p.id} className="mas-cart-line">
                  <div>
                    <div className="mas-cart-line-name">{l.p.name}</div>
                    <div className="mas-cart-line-qty">{l.qty} × {money(l.p.unit_price)}</div>
                    <button className="mas-cart-remove" onClick={() => removeFromCart(l.p.id)}>Remove</button>
                  </div>
                  <div className="mas-cart-line-total">{money(l.total)}</div>
                </div>
              ))}
              <div className="mas-cart-total">
                <span>Total</span>
                <span>{money(cartTotal)}</span>
              </div>

              <div className="mas-checkout">
                <h3>Shipping details</h3>
                <label>Recipient name
                  <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
                </label>
                <div className="mas-checkout-row">
                  <label>Phone
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </label>
                  <label>Email
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                </div>
                <label>Address line 1
                  <input type="text" value={addr1} onChange={(e) => setAddr1(e.target.value)} />
                </label>
                <label>Address line 2 (optional)
                  <input type="text" value={addr2} onChange={(e) => setAddr2(e.target.value)} />
                </label>
                <div className="mas-checkout-row">
                  <label>City
                    <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
                  </label>
                  <label>Postcode
                    <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
                  </label>
                </div>
                <label>State
                  <select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                    <option value="">Select…</option>
                    {states.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                  </select>
                </label>
                <label>Note (optional, max 200 chars)
                  <textarea rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>

                <button className="mas-checkout-submit" onClick={submit} disabled={busy}>
                  {busy ? 'Placing…' : `Place order · ${money(cartTotal)}`}
                </button>
              </div>
            </>
          )}

          {msg && (
            <p className={`mas-status ${msg.ok ? 'mas-status-good' : 'mas-status-bad'}`} style={{ marginTop: '0.6rem' }}>
              {msg.text}
            </p>
          )}
        </aside>
      </div>

      <div className="mas-store-orders">
        <h2>Your orders</h2>
        {ordersFailed && (
          <p className="mas-status mas-status-bad">Couldn’t load your orders just now. Please try again shortly.</p>
        )}
        {!ordersFailed && orders.length === 0 && <p className="mas-status">No orders yet.</p>}
        {orders.map((o) => (
          <div key={o.order_id} className="mas-store-order-card">
            <div className="mas-store-order-head">
              <div>
                <span className="mas-store-order-no">{o.order_no}</span>
                <span className="mas-store-order-date"> · {fmt(o.created_at)}</span>
              </div>
              <span className={statusChipClass(o.status)}>{pretty(o.status)}</span>
            </div>
            {o.items && o.items.length > 0 && (
              <p className="mas-store-order-items">
                {o.items.map((it) => `${it.qty} × ${it.label}`).join(' · ')}
              </p>
            )}
            <p className="mas-store-order-meta">
              {money(o.invoice_amount ?? o.total_amount)}
              {o.invoice_no && ` · Invoice ${o.invoice_no}`}
              {o.paid_at && ` · Paid ${fmt(o.paid_at)}`}
              {o.fulfilled_at && ` · Shipped ${fmt(o.fulfilled_at)}`}
              {o.tracking && <> · <span className="mas-store-order-tracking">Tracking: {o.tracking}</span></>}
              {o.recipient_name && ` · to ${o.recipient_name}${o.city ? ', ' + o.city : ''}`}
            </p>
          </div>
        ))}
      </div>

      {lightbox && (
        <div className="mas-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <button className="mas-lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">×</button>
          <img src={lightbox.src} alt={lightbox.alt} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </section>
  );
}

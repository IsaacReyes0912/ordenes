// ══════════════════════════════════════════════
//  cart.js — Lógica del carrito (Vanilla JS)
//  Usa localStorage para persistir entre páginas
// ══════════════════════════════════════════════

const CART_KEY = 'pedidos_cart';

// ─── Helpers de almacenamiento ────────────────
function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
}

// ─── Operaciones del carrito ─────────────────
function addToCart(product) {
  const cart = getCart();
  const existing = cart.find(i => i.id === product.id);
  if (existing) {
    if (existing.qty < product.stock) existing.qty++;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  saveCart(cart);
  renderCart();
  showCartPanel();
  flashFab();
}

function removeFromCart(productId) {
  const cart = getCart().filter(i => i.id !== productId);
  saveCart(cart);
  renderCart();
}

function changeQty(productId, delta) {
  const cart = getCart();
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(productId);
    return;
  }
  saveCart(cart);
  renderCart();
}

function getTotal() {
  return getCart().reduce((sum, i) => sum + i.price * i.qty, 0);
}

function getTotalItems() {
  return getCart().reduce((sum, i) => sum + i.qty, 0);
}

// ─── Renderizado del panel ────────────────────
function renderCart() {
  const cart = getCart();
  const itemsEl  = document.getElementById('cart-items');
  const totalEl  = document.getElementById('cart-total');
  const countEl  = document.getElementById('cart-count');
  const checkBtn = document.getElementById('checkout-btn');
  if (!itemsEl) return;

  countEl.textContent = getTotalItems();

  if (cart.length === 0) {
    itemsEl.innerHTML = `<div class="cart-empty">🛒<br>Tu carrito está vacío</div>`;
    totalEl.textContent = '$0.00';
    if (checkBtn) checkBtn.disabled = true;
    return;
  }
  if (checkBtn) checkBtn.disabled = false;

  itemsEl.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-name">${item.name}</div>
      <div class="cart-item-qty">
        <button class="qty-btn" onclick="changeQty(${item.id}, -1)">−</button>
        <span>${item.qty}</span>
        <button class="qty-btn" onclick="changeQty(${item.id}, 1)">+</button>
      </div>
      <div class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</div>
      <button class="cart-remove" onclick="removeFromCart(${item.id})" title="Eliminar">✕</button>
    </div>
  `).join('');

  totalEl.textContent = '$' + getTotal().toFixed(2);
}

// ─── Panel (abrir / cerrar) ───────────────────
function showCartPanel() {
  document.getElementById('cart-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}

function hideCartPanel() {
  document.getElementById('cart-panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

// ─── Animación del botón flotante ─────────────
function flashFab() {
  const fab = document.getElementById('cart-fab');
  if (!fab) return;
  fab.style.transform = 'scale(1.25)';
  setTimeout(() => (fab.style.transform = ''), 250);
}

// ─── Ir a checkout: inyecta items en el form ──
function goToCheckout() {
  const cart = getCart();
  if (cart.length === 0) return;

  // Redirigir a la página de checkout
  // El carrito se lee desde localStorage en la página de checkout
  window.location.href = '/checkout';
}

// ─── Init en carga de página ──────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderCart();

  // Botón flotante
  const fab = document.getElementById('cart-fab');
  if (fab) fab.addEventListener('click', showCartPanel);

  // Cerrar panel
  const closeBtn = document.getElementById('cart-close');
  if (closeBtn) closeBtn.addEventListener('click', hideCartPanel);

  const overlay = document.getElementById('overlay');
  if (overlay) overlay.addEventListener('click', hideCartPanel);

  // Botón checkout dentro del panel
  const checkBtn = document.getElementById('checkout-btn');
  if (checkBtn) checkBtn.addEventListener('click', goToCheckout);
});

// ══════════════════════════════════════════════════════
//  server.js — Servidor principal (Express + EJS)
// ══════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Configuración ────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));  // procesar forms POST
app.use(express.json());

// Sesión simple para el admin (sin JWT)
app.use(session({
  secret: 'mi_secreto_pedidos_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 2 }  // 2 horas
}));

// ─── Middleware: proteger rutas admin ─────────────────
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// ══════════════════════════════════════════════════════
//  RUTAS PÚBLICAS
// ══════════════════════════════════════════════════════

// GET / — Catálogo de productos
app.get('/', async (req, res) => {
  try {
    const [products] = await db.query(
      'SELECT * FROM products WHERE stock > 0 ORDER BY name'
    );
    res.render('catalog', { products });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar los productos.');
  }
});

// GET /checkout — Formulario de checkout
app.get('/checkout', (req, res) => {
  res.render('checkout');
});

// POST /checkout — Guardar pedido en la BD
app.post('/checkout', async (req, res) => {
  const { customer_name, phone, address, notes, items } = req.body;

  // items llega como JSON string desde el formulario oculto
  let cartItems;
  try {
    cartItems = JSON.parse(items);
  } catch {
    return res.status(400).send('Carrito inválido.');
  }

  if (!cartItems || cartItems.length === 0) {
    return res.redirect('/?error=carrito_vacio');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Calcular total y verificar precios desde la BD (seguridad)
    const productIds = cartItems.map(i => i.id);
    const [dbProducts] = await conn.query(
      'SELECT id, price, stock FROM products WHERE id IN (?)',
      [productIds]
    );
    const priceMap = {};
    dbProducts.forEach(p => (priceMap[p.id] = { price: p.price, stock: p.stock }));

    let total = 0;
    for (const item of cartItems) {
      const prod = priceMap[item.id];
      if (!prod) throw new Error(`Producto ${item.id} no existe.`);
      if (prod.stock < item.qty) throw new Error(`Sin stock: ${item.name}`);
      total += parseFloat(prod.price) * item.qty;
    }

    // 2. Insertar pedido
    const [orderResult] = await conn.query(
      'INSERT INTO orders (customer_name, phone, address, notes, total) VALUES (?, ?, ?, ?, ?)',
      [customer_name, phone, address, notes || null, total.toFixed(2)]
    );
    const orderId = orderResult.insertId;

    // 3. Insertar items
    for (const item of cartItems) {
      const unitPrice = priceMap[item.id].price;
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [orderId, item.id, item.qty, unitPrice]
      );
      // Descontar stock
      await conn.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.qty, item.id]
      );
    }

    await conn.commit();
    res.redirect('/confirmation/' + orderId);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send('Error al procesar el pedido: ' + err.message);
  } finally {
    conn.release();
  }
});

// GET /confirmation/:id — Confirmación de pedido
app.get('/confirmation/:id', async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).send('Pedido no encontrado.');
    const order = orders[0];

    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [order.id]
    );
    res.render('confirmation', { order, items });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar la confirmación.');
  }
});

// ══════════════════════════════════════════════════════
//  RUTAS ADMIN
// ══════════════════════════════════════════════════════

// GET /admin/login
app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

// POST /admin/login
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Contraseña incorrecta.' });
  }
});

// GET /admin/logout
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// GET /admin — Lista de pedidos
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const statusFilter = req.query.status || '';
    let query  = 'SELECT * FROM orders';
    let params = [];
    if (statusFilter) {
      query  += ' WHERE status = ?';
      params  = [statusFilter];
    }
    query += ' ORDER BY created_at DESC';

    const [orders] = await db.query(query, params);
    res.render('admin/orders', { orders, statusFilter });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar pedidos.');
  }
});

// GET /admin/order/:id — Detalle de pedido
app.get('/admin/order/:id', requireAdmin, async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).send('Pedido no encontrado.');
    const order = orders[0];

    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [order.id]
    );
    res.render('admin/order-detail', { order, items });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el pedido.');
  }
});

// POST /admin/order/:id/status — Cambiar estado
app.post('/admin/order/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pendiente', 'en_proceso', 'entregado', 'cancelado'];
  if (!validStatuses.includes(status)) {
    return res.status(400).send('Estado inválido.');
  }
  try {
    await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    res.redirect('/admin/order/' + req.params.id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar estado.');
  }
});

// ─── Arrancar servidor ────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🔧  Panel Admin    → http://localhost:${PORT}/admin`);
  console.log(`🛍️   Catálogo       → http://localhost:${PORT}/\n`);
});

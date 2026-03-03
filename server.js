// ══════════════════════════════════════════════════════
//  server.js — Servidor principal (Express + EJS)
// ══════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const db      = require('./db');
const { enviarConfirmacionPedido, enviarCambioEstado } = require('./mailer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Configuración ────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ─── Sesión única ─────────────────────────────────────
app.use(session({
  secret: 'mi_secreto_pedidos_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 2 }
}));

// Middleware global: pasar usuario a todas las vistas 
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// ─── Middleware: proteger rutas admin ─────────────────
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// ─── Middleware: proteger rutas de cliente ────────────
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

// ══════════════════════════════════════════════════════
//  RUTAS DE AUTENTICACIÓN DE CLIENTES
// ══════════════════════════════════════════════════════

app.get('/registro', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/registro', { error: null, values: {} });
});

app.post('/registro', async (req, res) => {
  const { name, email, phone, address, password, password2 } = req.body;
  const values = { name, email, phone, address };
  const bcrypt = require('bcrypt');

  if (!name || !email || !password)
    return res.render('auth/registro', { error: 'Nombre, email y contraseña son requeridos.', values });
  if (password !== password2)
    return res.render('auth/registro', { error: 'Las contraseñas no coinciden.', values });
  if (password.length < 6)
    return res.render('auth/registro', { error: 'La contraseña debe tener al menos 6 caracteres.', values });

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length > 0)
      return res.render('auth/registro', { error: 'Ese correo ya está registrado.', values });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, phone, address, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email.toLowerCase(), phone || null, address || null, hash, 'CLIENTE']
    );
    req.session.user = { id: result.insertId, name, email: email.toLowerCase(), role: 'CLIENTE' };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('auth/registro', { error: 'Error al crear la cuenta. Intenta de nuevo.', values });
  }
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { error: null, next: req.query.next || '/' });
});

app.post('/login', async (req, res) => {
  const { email, password, next } = req.body;
  const redirectTo = next || '/';
  const bcrypt = require('bcrypt');

  if (!email || !password)
    return res.render('auth/login', { error: 'Completa todos los campos.', next: redirectTo });

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (rows.length === 0)
      return res.render('auth/login', { error: 'Correo o contraseña incorrectos.', next: redirectTo });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.render('auth/login', { error: 'Correo o contraseña incorrectos.', next: redirectTo });

    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };

    // Redirigir según el rol
    if (user.role === 'EMPLEADO') return res.redirect('/empleado/pedidos');
    if (user.role === 'ADMIN') return res.redirect('/admin');
res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    res.render('auth/login', { error: 'Error al iniciar sesión.', next: redirectTo });
  }
});

app.get('/logout', (req, res) => {
  req.session.user = null;
  res.redirect('/');
});

app.get('/mi-cuenta', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    const user = rows[0];
    const [orders] = await db.query(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [req.session.user.id]
    );
    res.render('auth/mi-cuenta', { user, orders, success: req.query.updated === '1' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el perfil.');
  }
});

app.post('/mi-cuenta', requireAuth, async (req, res) => {
  const { name, phone, address } = req.body;
  try {
    await db.query(
      'UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?',
      [name, phone || null, address || null, req.session.user.id]
    );
    req.session.user.name = name;
    res.redirect('/mi-cuenta?updated=1');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar el perfil.');
  }
});

// ══════════════════════════════════════════════════════
//  RUTAS PÚBLICAS
// ══════════════════════════════════════════════════════

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

app.get('/checkout', (req, res) => {
  if (req.session.user) {
    db.query('SELECT phone, address FROM users WHERE id = ?', [req.session.user.id])
      .then(([rows]) => {
        const u = rows[0] || {};
        res.render('checkout', { prefill: { name: req.session.user.name, phone: u.phone, address: u.address } });
      })
      .catch(() => res.render('checkout', { prefill: null }));
  } else {
    res.render('checkout', { prefill: null });
  }
});

app.post('/checkout', async (req, res) => {
  const { customer_name, phone, address, notes, items } = req.body;

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

    const userId = req.session.user ? req.session.user.id : null;

    const [orderResult] = await conn.query(
      'INSERT INTO orders (user_id, customer_name, phone, address, notes, total) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, customer_name, phone, address, notes || null, total.toFixed(2)]
    );
    const orderId = orderResult.insertId;

    for (const item of cartItems) {
      const unitPrice = priceMap[item.id].price;
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [orderId, item.id, item.qty, unitPrice]
      );
      await conn.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.qty, item.id]
      );
    }

    await conn.commit();

// Enviar email de confirmación si el cliente está registrado
if (userId) {
  try {
    const [userRows] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
    if (userRows.length > 0) {
      const emailOrder = {
        id: orderId,
        customer_name,
        phone,
        address,
        total: total.toFixed(2),
        email: userRows[0].email
      };
      // Obtener items con nombre del producto para el email
      const [emailItems] = await db.query(
        `SELECT oi.*, p.name AS product_name
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?`,
        [orderId]
      );
      enviarConfirmacionPedido(emailOrder, emailItems).catch(console.error);
    }
  } catch (emailErr) {
    console.error('Error enviando email:', emailErr);
  }
}

res.redirect('/confirmation/' + orderId);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send('Error al procesar el pedido: ' + err.message);
  } finally {
    conn.release();
  }
});

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

app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Contraseña incorrecta.' });
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

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

app.post('/admin/order/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pendiente', 'en_proceso', 'entregado', 'cancelado'];
  if (!validStatuses.includes(status))
    return res.status(400).send('Estado inválido.');
  try {
    await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);

// Enviar email de cambio de estado si el pedido tiene usuario registrado
try {
  const [orderRows] = await db.query(
    `SELECT o.*, u.email AS email
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.id = ?`,
    [req.params.id]
  );
  if (orderRows.length > 0 && orderRows[0].email) {
    enviarCambioEstado(orderRows[0]).catch(console.error);
  }
} catch (emailErr) {
  console.error('Error enviando email:', emailErr);
}

res.redirect('/admin/order/' + req.params.id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar estado.');
  }
});

// ══════════════════════════════════════════════════════
//  RUTAS EMPLEADO
// ══════════════════════════════════════════════════════

function requireEmpleado(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role === 'EMPLEADO' || req.session.user.role === 'ADMIN')
    return next();
  res.status(403).send('Acceso denegado. No tienes permisos para esta sección.');
}

// GET /empleado/pedidos
app.get('/empleado/pedidos', requireEmpleado, async (req, res) => {
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
    res.render('empleado/pedidos', { orders, statusFilter });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar pedidos.');
  }
});

// GET /empleado/pedido/:id
app.get('/empleado/pedido/:id', requireEmpleado, async (req, res) => {
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
    res.render('empleado/detalle', { order, items });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el pedido.');
  }
});

// POST /empleado/pedido/:id/status
app.post('/empleado/pedido/:id/status', requireEmpleado, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pendiente', 'en_proceso', 'entregado', 'cancelado'];
  if (!validStatuses.includes(status))
    return res.status(400).send('Estado inválido.');
  try {
    await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);

// Enviar email de cambio de estado
try {
  const [orderRows] = await db.query(
    `SELECT o.*, u.email AS email
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.id = ?`,
    [req.params.id]
  );
  if (orderRows.length > 0 && orderRows[0].email) {
    enviarCambioEstado(orderRows[0]).catch(console.error);
  }
} catch (emailErr) {
  console.error('Error enviando email:', emailErr);
}

res.redirect('/empleado/pedido/' + req.params.id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar estado.');
  }
});

// ══════════════════════════════════════════════════════
//  RUTA REPORTES ADMIN
// ══════════════════════════════════════════════════════

app.get('/admin/reportes', requireAdmin, async (req, res) => {
  try {

    // 1. Ingresos totales y total de pedidos
    const [[{ ingresos, totalPedidos }]] = await db.query(`
      SELECT
        COALESCE(SUM(total), 0)  AS ingresos,
        COUNT(*)                  AS totalPedidos
      FROM orders
      WHERE status != 'cancelado'
    `);

    // 2. Pedidos de hoy
    const [[{ pedidosHoy }]] = await db.query(`
      SELECT COUNT(*) AS pedidosHoy
      FROM orders
      WHERE DATE(created_at) = CURDATE()
    `);

    // 3. Ticket promedio
    const ticketPromedio = totalPedidos > 0
      ? (parseFloat(ingresos) / totalPedidos).toFixed(2)
      : '0.00';

    // 4. Total clientes registrados
    const [[{ totalClientes }]] = await db.query(`
      SELECT COUNT(*) AS totalClientes FROM users WHERE role = 'CLIENTE'
    `);

    // 5. Ventas por día (últimos 7 días)
    const [ventasPorDia] = await db.query(`
     SELECT
       DATE_FORMAT(DATE(created_at), '%d/%m') AS fecha,
        COALESCE(SUM(total), 0)                AS total
     FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     AND status != 'cancelado'
     GROUP BY DATE(created_at), DATE_FORMAT(DATE(created_at), '%d/%m')
     ORDER BY DATE(created_at) ASC
    `);

    // 6. Productos más vendidos (top 6)
    const [productosMasVendidos] = await db.query(`
      SELECT
        p.name        AS nombre,
        SUM(oi.quantity) AS cantidad
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o   ON o.id = oi.order_id
      WHERE o.status != 'cancelado'
      GROUP BY p.id
      ORDER BY cantidad DESC
      LIMIT 6
    `);

    // 7. Pedidos por estado
    const [pedidosPorEstado] = await db.query(`
      SELECT status, COUNT(*) AS total
      FROM orders
      GROUP BY status
    `);

    // 8. Últimos 5 pedidos
    const [ultimosPedidos] = await db.query(`
      SELECT * FROM orders ORDER BY created_at DESC LIMIT 5
    `);

    res.render('admin/reportes', {
      resumen: {
        ingresos:      parseFloat(ingresos).toFixed(2),
        totalPedidos,
        pedidosHoy,
        ticketPromedio,
        totalClientes
      },
      ventasPorDia,
      productosMasVendidos,
      pedidosPorEstado,
      ultimosPedidos
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar los reportes.');
  }
});

// ─── Arrancar servidor ────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🔧  Panel Admin    → http://localhost:${PORT}/admin`);
  console.log(`🛍️   Catálogo       → http://localhost:${PORT}/\n`);
});

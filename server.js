// ══════════════════════════════════════════════════════
//  server.js — Servidor principal (Express + EJS)
// ══════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const db      = require('./db');
const {
  enviarConfirmacionPedido,
  enviarCambioEstado,
  enviarDenegacionSolicitud
} = require('./mailer');
const { crearOrdenPayPal, capturarOrdenPayPal } = require('./paypal');

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
        res.render('checkout', {
          prefill: { name: req.session.user.name, phone: u.phone, address: u.address },
          paypalClientId: process.env.PAYPAL_CLIENT_ID
        });
      })
      .catch(() => res.render('checkout', { prefill: null, paypalClientId: process.env.PAYPAL_CLIENT_ID }));
  } else {
    res.render('checkout', { prefill: null, paypalClientId: process.env.PAYPAL_CLIENT_ID });
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

    if (userId) {
      try {
        const [userRows] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
        if (userRows.length > 0) {
          const emailOrder = {
            id: orderId, customer_name, phone, address,
            total: total.toFixed(2), email: userRows[0].email
          };
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
//  SOLICITUDES DE PROBLEMA / DEVOLUCIÓN
// ══════════════════════════════════════════════════════

async function obtenerSolicitudCompleta(requestId) {
  const [rows] = await db.query(
    `SELECT
        rr.*,
        o.user_id       AS order_user_id,
        o.customer_name,
        o.phone,
        o.address,
        o.notes         AS order_notes,
        o.total,
        o.status        AS order_status,
        u.email,
        u.name          AS user_name
     FROM return_requests rr
     JOIN orders o ON o.id = rr.order_id
     JOIN users  u ON u.id = rr.user_id
     WHERE rr.id = ?`,
    [requestId]
  );

  return rows.length ? rows[0] : null;
}

async function aprobarSolicitudYCrearNuevoPedido(requestId, actorRol, resolutionNote) {
  const solicitud = await obtenerSolicitudCompleta(requestId);
  if (!solicitud) throw new Error('Solicitud no encontrada.');
  if (solicitud.status !== 'pendiente') throw new Error('La solicitud ya fue procesada.');

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [originalItems] = await conn.query(
      `SELECT oi.*, p.name AS product_name, p.stock
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [solicitud.order_id]
    );

    if (!originalItems.length) {
      throw new Error('El pedido original no tiene productos.');
    }

    for (const item of originalItems) {
      if (item.stock < item.quantity) {
        throw new Error(`Stock insuficiente para reenviar: ${item.product_name}`);
      }
    }

    const notasNuevas = [
      solicitud.order_notes || '',
      `Reposición automática por solicitud #${solicitud.id}.`,
      resolutionNote ? `Resolución: ${resolutionNote}` : ''
    ].filter(Boolean).join(' | ');

    const [newOrderResult] = await conn.query(
      `INSERT INTO orders (user_id, customer_name, phone, address, notes, total, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pendiente')`,
      [
        solicitud.order_user_id,
        solicitud.customer_name,
        solicitud.phone,
        solicitud.address,
        notasNuevas,
        solicitud.total
      ]
    );

    const newOrderId = newOrderResult.insertId;

    for (const item of originalItems) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES (?, ?, ?, ?)`,
        [newOrderId, item.product_id, item.quantity, item.unit_price]
      );

      await conn.query(
        `UPDATE products SET stock = stock - ? WHERE id = ?`,
        [item.quantity, item.product_id]
      );
    }

    await conn.query(
      `UPDATE return_requests
       SET status = 'aprobada',
           resolution_note = ?,
           reviewed_by = ?,
           reviewed_at = NOW(),
           new_order_id = ?
       WHERE id = ?`,
      [resolutionNote || null, actorRol, newOrderId, requestId]
    );

    await conn.commit();

    const [emailItems] = await db.query(
      `SELECT oi.*, p.name AS product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [newOrderId]
    );

    if (solicitud.email) {
      const emailOrder = {
        id: newOrderId,
        customer_name: solicitud.customer_name,
        phone: solicitud.phone,
        address: solicitud.address,
        total: parseFloat(solicitud.total).toFixed(2),
        email: solicitud.email
      };

      try {
        await enviarConfirmacionPedido(emailOrder, emailItems);
      } catch (emailErr) {
        console.error('Error enviando correo de reposición:', emailErr);
      }
    }

    return newOrderId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

app.get('/problema-pedido', requireAuth, async (req, res) => {
  try {
    const selectedOrderId = req.query.orderId || '';
    const [orders] = await db.query(
      `SELECT id, total, status, created_at
       FROM orders
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.session.user.id]
    );

    res.render('auth/problema-pedido', {
      orders,
      selectedOrderId,
      success: req.query.ok === '1',
      error: null,
      old: {}
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el formulario.');
  }
});

app.post('/problema-pedido', requireAuth, async (req, res) => {
  const { order_id, problem_note } = req.body;

  try {
    const [orders] = await db.query(
      `SELECT id, total, status, created_at
       FROM orders
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.session.user.id]
    );

    if (!order_id || !problem_note || !problem_note.trim()) {
      return res.render('auth/problema-pedido', {
        orders,
        selectedOrderId: order_id || '',
        success: false,
        error: 'Debes seleccionar un pedido y explicar el problema.',
        old: { problem_note }
      });
    }

    const [ownedOrder] = await db.query(
      `SELECT id FROM orders WHERE id = ? AND user_id = ?`,
      [order_id, req.session.user.id]
    );

    if (!ownedOrder.length) {
      return res.render('auth/problema-pedido', {
        orders,
        selectedOrderId: order_id,
        success: false,
        error: 'Ese pedido no pertenece a tu cuenta.',
        old: { problem_note }
      });
    }

    const [existingPending] = await db.query(
      `SELECT id FROM return_requests
       WHERE order_id = ? AND user_id = ? AND status = 'pendiente'`,
      [order_id, req.session.user.id]
    );

    if (existingPending.length) {
      return res.render('auth/problema-pedido', {
        orders,
        selectedOrderId: order_id,
        success: false,
        error: 'Ya existe una solicitud pendiente para ese pedido.',
        old: { problem_note }
      });
    }

    await db.query(
      `INSERT INTO return_requests (order_id, user_id, problem_note)
       VALUES (?, ?, ?)`,
      [order_id, req.session.user.id, problem_note.trim()]
    );

    res.redirect('/problema-pedido?ok=1');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al guardar la solicitud.');
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
    const allowedLimits = [10, 25, 50];
    const limit = allowedLimits.includes(parseInt(req.query.limit))
      ? parseInt(req.query.limit)
      : 10;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    let whereClause = '';
    let whereParams = [];

    if (statusFilter) {
      whereClause = ' WHERE status = ?';
      whereParams = [statusFilter];
    }

    const countQuery = `SELECT COUNT(*) AS total FROM orders${whereClause}`;
    const [countRows] = await db.query(countQuery, whereParams);
    const totalOrders = countRows[0].total;
    const totalPages = Math.max(Math.ceil(totalOrders / limit), 1);

    const dataQuery = `
      SELECT * FROM orders
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [orders] = await db.query(dataQuery, [...whereParams, limit, offset]);

    res.render('admin/orders', {
      orders,
      statusFilter,
      currentPage: page,
      totalPages,
      limit,
      totalOrders
    });
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
//  DEVOLUCIONES / PROBLEMAS — ADMIN
// ══════════════════════════════════════════════════════

app.get('/admin/devoluciones', requireAdmin, async (req, res) => {
  try {
    const statusFilter = req.query.status || '';
    const orderIdFilter = req.query.orderId || '';

    const conditions = [];
    const params = [];

    if (statusFilter) {
      conditions.push('rr.status = ?');
      params.push(statusFilter);
    }

    if (orderIdFilter) {
      conditions.push('rr.order_id = ?');
      params.push(orderIdFilter);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [requests] = await db.query(
      `SELECT
          rr.*,
          o.customer_name,
          o.phone,
          o.total,
          u.email
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       JOIN users  u ON u.id = rr.user_id
       ${whereClause}
       ORDER BY rr.created_at DESC`,
      params
    );

    res.render('admin/devoluciones', { requests, statusFilter, orderIdFilter });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar solicitudes.');
  }
});

app.get('/admin/devolucion/:id', requireAdmin, async (req, res) => {
  try {
    const request = await obtenerSolicitudCompleta(req.params.id);
    if (!request) return res.status(404).send('Solicitud no encontrada.');

    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [request.order_id]
    );

    res.render('admin/devolucion-detalle', {
      request,
      items,
      success: req.query.ok || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar la solicitud.');
  }
});

app.post('/admin/devolucion/:id/aprobar', requireAdmin, async (req, res) => {
  try {
    const { resolution_note } = req.body;
    await aprobarSolicitudYCrearNuevoPedido(req.params.id, 'ADMIN', resolution_note || null);
    res.redirect(`/admin/devolucion/${req.params.id}?ok=approved`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al aprobar la solicitud: ' + err.message);
  }
});

app.post('/admin/devolucion/:id/denegar', requireAdmin, async (req, res) => {
  try {
    const { resolution_note } = req.body;

    const request = await obtenerSolicitudCompleta(req.params.id);
    if (!request) return res.status(404).send('Solicitud no encontrada.');
    if (request.status !== 'pendiente') return res.status(400).send('La solicitud ya fue procesada.');

    await db.query(
      `UPDATE return_requests
       SET status = 'denegada',
           resolution_note = ?,
           reviewed_by = 'ADMIN',
           reviewed_at = NOW()
       WHERE id = ?`,
      [resolution_note || null, req.params.id]
    );

    if (request.email) {
      try {
        await enviarDenegacionSolicitud({
          email: request.email,
          customer_name: request.customer_name,
          order_id: request.order_id,
          request_id: request.id,
          resolution_note: resolution_note || null
        });
      } catch (emailErr) {
        console.error('Error enviando correo de denegación:', emailErr);
      }
    }

    res.redirect(`/admin/devolucion/${req.params.id}?ok=denied`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al denegar la solicitud.');
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

app.get('/empleado/pedidos', requireEmpleado, async (req, res) => {
  try {
    const statusFilter = req.query.status || '';
    const allowedLimits = [10, 25, 50];
    const limit = allowedLimits.includes(parseInt(req.query.limit))
      ? parseInt(req.query.limit)
      : 10;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    let whereClause = '';
    let whereParams = [];

    if (statusFilter) {
      whereClause = ' WHERE status = ?';
      whereParams = [statusFilter];
    }

    const countQuery = `SELECT COUNT(*) AS total FROM orders${whereClause}`;
    const [countRows] = await db.query(countQuery, whereParams);
    const totalOrders = countRows[0].total;
    const totalPages = Math.max(Math.ceil(totalOrders / limit), 1);

    const dataQuery = `
      SELECT * FROM orders
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [orders] = await db.query(dataQuery, [...whereParams, limit, offset]);

    res.render('empleado/pedidos', {
      orders,
      statusFilter,
      currentPage: page,
      totalPages,
      limit,
      totalOrders
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar pedidos.');
  }
});

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

app.post('/empleado/pedido/:id/status', requireEmpleado, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pendiente', 'en_proceso', 'entregado', 'cancelado'];
  if (!validStatuses.includes(status))
    return res.status(400).send('Estado inválido.');
  try {
    await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);

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
//  DEVOLUCIONES / PROBLEMAS — EMPLEADO
// ══════════════════════════════════════════════════════

app.get('/empleado/devoluciones', requireEmpleado, async (req, res) => {
  try {
    const statusFilter = req.query.status || '';
    const orderIdFilter = req.query.orderId || '';

    const conditions = [];
    const params = [];

    if (statusFilter) {
      conditions.push('rr.status = ?');
      params.push(statusFilter);
    }

    if (orderIdFilter) {
      conditions.push('rr.order_id = ?');
      params.push(orderIdFilter);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [requests] = await db.query(
      `SELECT
          rr.*,
          o.customer_name,
          o.phone,
          o.total,
          u.email
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       JOIN users  u ON u.id = rr.user_id
       ${whereClause}
       ORDER BY rr.created_at DESC`,
      params
    );

    res.render('empleado/devoluciones', { requests, statusFilter, orderIdFilter });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar solicitudes.');
  }
});

app.get('/empleado/devolucion/:id', requireEmpleado, async (req, res) => {
  try {
    const request = await obtenerSolicitudCompleta(req.params.id);
    if (!request) return res.status(404).send('Solicitud no encontrada.');

    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [request.order_id]
    );

    res.render('empleado/devolucion-detalle', {
      request,
      items,
      success: req.query.ok || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar la solicitud.');
  }
});

app.post('/empleado/devolucion/:id/aprobar', requireEmpleado, async (req, res) => {
  try {
    const { resolution_note } = req.body;
    await aprobarSolicitudYCrearNuevoPedido(req.params.id, 'EMPLEADO', resolution_note || null);
    res.redirect(`/empleado/devolucion/${req.params.id}?ok=approved`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al aprobar la solicitud: ' + err.message);
  }
});

app.post('/empleado/devolucion/:id/denegar', requireEmpleado, async (req, res) => {
  try {
    const { resolution_note } = req.body;

    const request = await obtenerSolicitudCompleta(req.params.id);
    if (!request) return res.status(404).send('Solicitud no encontrada.');
    if (request.status !== 'pendiente') return res.status(400).send('La solicitud ya fue procesada.');

    await db.query(
      `UPDATE return_requests
       SET status = 'denegada',
           resolution_note = ?,
           reviewed_by = 'EMPLEADO',
           reviewed_at = NOW()
       WHERE id = ?`,
      [resolution_note || null, req.params.id]
    );

    if (request.email) {
      try {
        await enviarDenegacionSolicitud({
          email: request.email,
          customer_name: request.customer_name,
          order_id: request.order_id,
          request_id: request.id,
          resolution_note: resolution_note || null
        });
      } catch (emailErr) {
        console.error('Error enviando correo de denegación:', emailErr);
      }
    }

    res.redirect(`/empleado/devolucion/${req.params.id}?ok=denied`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al denegar la solicitud.');
  }
});


// ══════════════════════════════════════════════════════
//  RUTAS DE PAGO PAYPAL
// ══════════════════════════════════════════════════════

app.post('/paypal/crear-orden', async (req, res) => {
  const { total } = req.body;
  try {
    const orden = await crearOrdenPayPal(total);
    res.json({ id: orden.id });
  } catch (err) {
    console.error('Error creando orden PayPal:', err);
    res.status(500).json({ error: 'Error al crear orden de pago.' });
  }
});

app.post('/paypal/capturar-orden', async (req, res) => {
  const { paypalOrderId, pedidoData } = req.body;
  try {
    const captura = await capturarOrdenPayPal(paypalOrderId);

    if (captura.status === 'COMPLETED') {
      const { customer_name, phone, address, notes, items, total } = pedidoData;
      let cartItems;
      try { cartItems = JSON.parse(items); } catch { return res.status(400).json({ error: 'Carrito inválido.' }); }

      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        const productIds = cartItems.map(i => i.id);
        const [dbProducts] = await conn.query(
          'SELECT id, price, stock FROM products WHERE id IN (?)', [productIds]
        );
        const priceMap = {};
        dbProducts.forEach(p => (priceMap[p.id] = { price: p.price, stock: p.stock }));

        let totalReal = 0;
        for (const item of cartItems) {
          const prod = priceMap[item.id];
          if (!prod) throw new Error(`Producto ${item.id} no existe.`);
          if (prod.stock < item.qty) throw new Error(`Sin stock: producto #${item.id}`);
          totalReal += parseFloat(prod.price) * item.qty;
        }

        const userId = req.session.user ? req.session.user.id : null;

        const [orderResult] = await conn.query(
          `INSERT INTO orders 
           (user_id, customer_name, phone, address, notes, total, payment_status, paypal_order_id) 
           VALUES (?, ?, ?, ?, ?, ?, 'pagado', ?)`,
          [userId, customer_name, phone, address, notes || null, totalReal.toFixed(2), paypalOrderId]
        );
        const orderId = orderResult.insertId;

        for (const item of cartItems) {
          await conn.query(
            'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
            [orderId, item.id, item.qty, priceMap[item.id].price]
          );
          await conn.query(
            'UPDATE products SET stock = stock - ? WHERE id = ?',
            [item.qty, item.id]
          );
        }

        await conn.commit();

        if (userId) {
          try {
            const [userRows] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
            if (userRows.length > 0) {
              const emailOrder = {
                id: orderId, customer_name, phone, address,
                total: totalReal.toFixed(2), email: userRows[0].email
              };
              const [emailItems] = await db.query(
                `SELECT oi.*, p.name AS product_name FROM order_items oi
                 JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
                [orderId]
              );
              enviarConfirmacionPedido(emailOrder, emailItems).catch(console.error);
            }
          } catch (emailErr) {
            console.error('Error enviando email:', emailErr);
          }
        }

        res.json({ success: true, orderId });
      } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ error: 'Error al guardar el pedido.' });
      } finally {
        conn.release();
      }
    } else {
      res.status(400).json({ error: 'Pago no completado.' });
    }
  } catch (err) {
    console.error('Error capturando orden PayPal:', err);
    res.status(500).json({ error: 'Error al procesar el pago.' });
  }
});

// ══════════════════════════════════════════════════════
//  RUTA REPORTES ADMIN
// ══════════════════════════════════════════════════════

app.get('/admin/reportes', requireAdmin, async (req, res) => {
  try {
    const [[{ ingresos, totalPedidos }]] = await db.query(`
      SELECT COALESCE(SUM(total), 0) AS ingresos, COUNT(*) AS totalPedidos
      FROM orders WHERE status != 'cancelado'
    `);

    const [[{ pedidosHoy }]] = await db.query(`
      SELECT COUNT(*) AS pedidosHoy FROM orders WHERE DATE(created_at) = CURDATE()
    `);

    const ticketPromedio = totalPedidos > 0
      ? (parseFloat(ingresos) / totalPedidos).toFixed(2) : '0.00';

    const [[{ totalClientes }]] = await db.query(`
      SELECT COUNT(*) AS totalClientes FROM users WHERE role = 'CLIENTE'
    `);

    const [ventasPorDia] = await db.query(`
      SELECT DATE_FORMAT(DATE(created_at), '%d/%m') AS fecha,
             COALESCE(SUM(total), 0) AS total
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND status != 'cancelado'
      GROUP BY DATE(created_at), DATE_FORMAT(DATE(created_at), '%d/%m')
      ORDER BY DATE(created_at) ASC
    `);

    const [productosMasVendidos] = await db.query(`
      SELECT p.name AS nombre, SUM(oi.quantity) AS cantidad
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelado'
      GROUP BY p.id ORDER BY cantidad DESC LIMIT 6
    `);

    const [pedidosPorEstado] = await db.query(`
      SELECT status, COUNT(*) AS total FROM orders GROUP BY status
    `);

    const [ultimosPedidos] = await db.query(`
      SELECT * FROM orders ORDER BY created_at DESC LIMIT 5
    `);

    res.render('admin/reportes', {
      resumen: { ingresos: parseFloat(ingresos).toFixed(2), totalPedidos, pedidosHoy, ticketPromedio, totalClientes },
      ventasPorDia, productosMasVendidos, pedidosPorEstado, ultimosPedidos
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
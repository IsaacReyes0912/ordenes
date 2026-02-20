-- ══════════════════════════════════════════════════════
--  SISTEMA DE PEDIDOS EN LÍNEA — Esquema de base de datos
-- ══════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS pedidos_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE pedidos_db;

-- ──────────────────────────────────────────────────────
--  TABLA: products
-- ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(150)   NOT NULL,
  price     DECIMAL(10,2)  NOT NULL,
  stock     INT            NOT NULL DEFAULT 0,
  image_url VARCHAR(300)   DEFAULT NULL,
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────
--  TABLA: orders
-- ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(150)  NOT NULL,
  phone         VARCHAR(30)   NOT NULL,
  address       VARCHAR(300)  NOT NULL,
  notes         TEXT          DEFAULT NULL,
  status        ENUM('pendiente','en_proceso','entregado','cancelado')
                              NOT NULL DEFAULT 'pendiente',
  total         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────
--  TABLA: order_items
-- ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  order_id    INT            NOT NULL,
  product_id  INT            NOT NULL,
  quantity    INT            NOT NULL,
  unit_price  DECIMAL(10,2)  NOT NULL,
  FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ──────────────────────────────────────────────────────
--  DATOS DE EJEMPLO — 8 productos
-- ──────────────────────────────────────────────────────
INSERT INTO products (name, price, stock, image_url) VALUES
  ('Hamburguesa Clásica',        89.00, 50, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400'),
  ('Hamburguesa BBQ Doble',     119.00, 40, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400'),
  ('Pizza Margherita (8 pzs)',  129.00, 30, 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400'),
  ('Pizza Pepperoni (8 pzs)',   149.00, 25, 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400'),
  ('Orden de Papas Fritas',      45.00, 80, 'https://images.unsplash.com/photo-1576107232684-1279f390859f?w=400'),
  ('Alitas BBQ (10 pzas)',       99.00, 35, 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=400'),
  ('Refresco 600ml',             30.00, 100, 'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400'),
  ('Agua Natural 600ml',         20.00, 100, 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400');

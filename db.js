// db.js — Conexión a MySQL usando mysql2
require('dotenv').config();
const mysql = require('mysql2/promise');

// Pool de conexiones: reutiliza conexiones en lugar de abrir una nueva cada vez
const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;

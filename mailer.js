//Módulo para envío de emails

require('dotenv').config();
const nodemailer = require('nodemailer');

// Configuración del transporter con Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

//Email: Confirmación de pedido 
async function enviarConfirmacionPedido(order, items) {
  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding:.5rem; border-bottom:1px solid #eee;">${item.product_name}</td>
      <td style="padding:.5rem; border-bottom:1px solid #eee; text-align:center;">${item.quantity}</td>
      <td style="padding:.5rem; border-bottom:1px solid #eee; text-align:right; color:#e85d04; font-weight:700;">
        $${(item.quantity * item.unit_price).toFixed(2)}
      </td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family: Segoe UI, sans-serif; max-width:600px; margin:0 auto;">
      <div style="background:#1a1a2e; padding:1.5rem; border-radius:12px 12px 0 0; text-align:center;">
        <h1 style="color:#e85d04; margin:0;">🍔 Pedidos Online</h1>
      </div>
      <div style="background:#fff; padding:2rem; border:1px solid #eee;">
        <h2 style="color:#1a1a2e;">✅ ¡Pedido confirmado!</h2>
        <p>Hola <strong>${order.customer_name}</strong>, recibimos tu pedido correctamente.</p>

        <div style="background:#f4f4f4; border-radius:8px; padding:1rem; margin:1.5rem 0;">
          <p style="margin:.3rem 0;"><strong>Pedido #:</strong> ${order.id}</p>
          <p style="margin:.3rem 0;"><strong>Dirección:</strong> ${order.address}</p>
          <p style="margin:.3rem 0;"><strong>Teléfono:</strong> ${order.phone}</p>
        </div>

        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:#f4f4f4;">
              <th style="padding:.5rem; text-align:left;">Producto</th>
              <th style="padding:.5rem; text-align:center;">Cant.</th>
              <th style="padding:.5rem; text-align:right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding:.8rem; font-weight:700; text-align:right;">Total:</td>
              <td style="padding:.8rem; font-weight:700; color:#e85d04; font-size:1.1rem; text-align:right;">
                $${parseFloat(order.total).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p style="color:#666; font-size:.9rem; margin-top:1.5rem;">
          Pronto nos pondremos en contacto contigo. ¡Gracias por tu pedido!
        </p>
      </div>
      <div style="background:#f4f4f4; padding:1rem; border-radius:0 0 12px 12px; text-align:center; font-size:.8rem; color:#999;">
        Pedidos Online © 2025
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: order.email,
    subject: `✅ Pedido #${order.id} confirmado — Pedidos Online`,
    html
  });
}

// Email:Cambio de estado
async function enviarCambioEstado(order) {
  const estadoTexto = {
    pendiente:  '⏳ Pendiente',
    en_proceso: '🔄 En proceso',
    entregado:  '✅ Entregado',
    cancelado:  '❌ Cancelado'
  };

  const html = `
    <div style="font-family: Segoe UI, sans-serif; max-width:600px; margin:0 auto;">
      <div style="background:#1a1a2e; padding:1.5rem; border-radius:12px 12px 0 0; text-align:center;">
        <h1 style="color:#e85d04; margin:0;">🍔 Pedidos Online</h1>
      </div>
      <div style="background:#fff; padding:2rem; border:1px solid #eee;">
        <h2 style="color:#1a1a2e;">📦 Actualización de tu pedido</h2>
        <p>Hola <strong>${order.customer_name}</strong>, tu pedido ha sido actualizado.</p>

        <div style="background:#f4f4f4; border-radius:8px; padding:1rem; margin:1.5rem 0;">
          <p style="margin:.3rem 0;"><strong>Pedido #:</strong> ${order.id}</p>
          <p style="margin:.3rem 0;"><strong>Nuevo estado:</strong>
            <span style="font-weight:700; color:#e85d04;">
              ${estadoTexto[order.status] || order.status}
            </span>
          </p>
        </div>

        <p style="color:#666; font-size:.9rem;">¡Gracias por confiar en nosotros!</p>
      </div>
      <div style="background:#f4f4f4; padding:1rem; border-radius:0 0 12px 12px; text-align:center; font-size:.8rem; color:#999;">
        Pedidos Online © 2025
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: order.email,
    subject: `📦 Tu pedido #${order.id} está: ${estadoTexto[order.status] || order.status}`,
    html
  });
}

module.exports = { enviarConfirmacionPedido, enviarCambioEstado };
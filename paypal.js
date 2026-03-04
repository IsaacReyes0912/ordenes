
//  Módulo para pagos con PayPal

require('dotenv').config();
const { Client, Environment, OrdersController } = require('@paypal/paypal-server-sdk');

// Configurar cliente PayPal
const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId:     process.env.PAYPAL_CLIENT_ID,
    oAuthClientSecret: process.env.PAYPAL_SECRET
  },
  environment: process.env.PAYPAL_MODE === 'sandbox'
    ? Environment.Sandbox
    : Environment.Production
});

const ordersController = new OrdersController(client);

// Crear orden de pago en PayPal 
async function crearOrdenPayPal(total) {
  const response = await ordersController.createOrder({
    body: {
      intent: 'CAPTURE',
      purchaseUnits: [{
        amount: {
          currencyCode: 'USD',
          value: parseFloat(total).toFixed(2)
        }
      }]
    }
  });
  return response.result;
}

// Capturar pago después de aprobación
async function capturarOrdenPayPal(paypalOrderId) {
  const response = await ordersController.captureOrder({
    id: paypalOrderId,
    body: {}
  });
  return response.result;
}

module.exports = { crearOrdenPayPal, capturarOrdenPayPal };
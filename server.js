const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public'));

const API_KEY = process.env.RAMASHOP_API_KEY;
const BASE_URL = 'https://ramashop.my.id/api/public';
const WA_NUMBER = process.env.WA_NUMBER || '6281234567890';

// ── Harga Robux ──
const HARGA = {
  hemat:   108, // Rp/Robux
  instant: 160, // Rp/Robux
};

// Simpan order sementara di memory (ganti Redis/DB buat production)
const orders = new Map();

// ── GET /api/harga ──
app.get('/api/harga', (req, res) => {
  res.json({ success: true, data: HARGA });
});

// ── POST /api/order/create ──
// Body: { username, userId, paket, jumlahRbx, jenis }
app.post('/api/order/create', async (req, res) => {
  try {
    const { username, userId, paket, jumlahRbx, jenis } = req.body;

    if (!username || !jumlahRbx || !jenis) {
      return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
    }

    const rbx = parseInt(jumlahRbx);
    if (rbx < 50) {
      return res.status(400).json({ success: false, message: 'Minimal 50 Robux' });
    }

    const rate = HARGA[jenis] || HARGA.hemat;
    const amount = rbx * rate;

    // Buat deposit QRIS ke Ramashop
    const depositRes = await fetch(`${BASE_URL}/deposit/create`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, method: 'qris' }),
    });

    const depositData = await depositRes.json();

    if (!depositData.success) {
      return res.status(500).json({ success: false, message: 'Gagal membuat pembayaran', detail: depositData });
    }

    const orderId = 'RL' + Date.now();
    const orderData = {
      orderId,
      depositId: depositData.data.depositId,
      username,
      userId: userId || '-',
      paket: paket || `${rbx} Robux`,
      jumlahRbx: rbx,
      jenis,
      amount,
      totalAmount: depositData.data.totalAmount,
      uniqueCode: depositData.data.uniqueCode,
      qrImage: depositData.data.qrImage,
      qrString: depositData.data.qrString,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiredAt: depositData.data.expiredAt,
    };

    orders.set(orderId, orderData);

    res.json({
      success: true,
      data: {
        orderId,
        depositId: depositData.data.depositId,
        amount,
        totalAmount: depositData.data.totalAmount,
        uniqueCode: depositData.data.uniqueCode,
        qrImage: depositData.data.qrImage,
        qrString: depositData.data.qrString,
        expiredAt: depositData.data.expiredAt,
        message: depositData.message,
      },
    });
  } catch (err) {
    console.error('Error create order:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/order/status/:orderId ──
app.get('/api/order/status/:orderId', async (req, res) => {
  try {
    const order = orders.get(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    }

    // Cek status ke Ramashop
    const statusRes = await fetch(`${BASE_URL}/deposit/status/${order.depositId}`, {
      headers: { 'X-API-Key': API_KEY },
    });

    const statusData = await statusRes.json();
    const payStatus = statusData?.data?.status;

    if (payStatus === 'success' && order.status !== 'paid') {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      orders.set(order.orderId, order);

      // Log order berhasil (di production: simpan ke DB, kirim notif WA admin, dll)
      console.log(`✅ ORDER BERHASIL: ${order.orderId} | ${order.username} | ${order.jumlahRbx} Rbx | Rp${order.amount}`);
    }

    res.json({
      success: true,
      data: {
        orderId: order.orderId,
        status: order.status,
        paymentStatus: payStatus,
        username: order.username,
        jumlahRbx: order.jumlahRbx,
        jenis: order.jenis,
        amount: order.amount,
        paidAt: order.paidAt || null,
      },
    });
  } catch (err) {
    console.error('Error cek status:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/balance ── (cek saldo Ramashop lo)
app.get('/api/balance', async (req, res) => {
  try {
    const r = await fetch(`${BASE_URL}/balance`, {
      headers: { 'X-API-Key': API_KEY },
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 RoLox Backend running on port ${PORT}`);
});

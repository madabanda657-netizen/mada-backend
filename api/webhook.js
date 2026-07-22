const crypto = require('crypto');
const { admin, db } = require('./_lib/firebaseAdmin');

module.exports = async (req, res) => {
  // No CORS needed for webhook, but keep it simple
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const signature = req.headers['x-paychangu-signature']; // Check actual header name in PayChangu docs

    // 1. Verify webhook signature
    const expected = crypto
      .createHmac('sha256', process.env.PAYCHANGU_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (signature !== expected) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. Extract data (adjust to PayChangu's actual payload structure)
    const { reference, status, amount, userId } = payload;

    if (status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ message: 'Payment not completed, ignoring' });
    }

    // 3. Atomically increment balance using transaction
    const userRef = db.ref(`users/${userId}`);
    await userRef.transaction((current) => {
      if (current === null) return null;
      current.balance = (current.balance || 0) + amount;
      return current;
    });

    // 4. Update pending transaction to 'completed'
    const txnsRef = db.ref(`users/${userId}/transactions`);
    const snap = await txnsRef.orderByChild('reference').equalTo(reference).once('value');
    if (snap.exists()) {
      const key = Object.keys(snap.val())[0];
      await db.ref(`users/${userId}/transactions/${key}`).update({
        status: 'completed',
        completedAt: admin.database.ServerValue.TIMESTAMP,
      });
    } else {
      // fallback: create a completed transaction
      await txnsRef.push({
        type: 'deposit',
        amount,
        status: 'completed',
        reference,
        createdAt: admin.database.ServerValue.TIMESTAMP,
      });
    }

    res.status(200).json({ message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

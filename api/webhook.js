const crypto = require('crypto');
const { admin, db } = require('./_lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    // PayChangu sends signature in header – verify
    const signature = req.headers['x-paychangu-signature']; // confirm actual header name

    // 1. Verify webhook signature
    const expected = crypto
      .createHmac('sha256', process.env.PAYCHANGU_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (signature !== expected) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. Extract data (adjust to actual PayChangu payload structure)
    const { tx_ref, status, amount, meta } = payload;
    const uid = meta?.uid || payload.uid; // fallback

    if (status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ message: 'Payment not completed, ignoring' });
    }

    if (!uid || !amount) {
      console.warn('Missing uid or amount in webhook payload');
      return res.status(400).json({ error: 'Invalid payload' });
    }

    // 3. Atomically increment user balance
    const userRef = db.ref(`users/${uid}`);
    await userRef.transaction((current) => {
      if (current === null) {
        // Create user if missing (edge case)
        return { balance: Number(amount) };
      }
      current.balance = (current.balance || 0) + Number(amount);
      return current;
    });

    // 4. Update pending deposit status
    const pendingRef = db.ref(`pending_deposits/${tx_ref}`);
    const snap = await pendingRef.once('value');
    if (snap.exists()) {
      await pendingRef.update({
        status: 'completed',
        completedAt: admin.database.ServerValue.TIMESTAMP,
      });
    }

    // 5. Record transaction in user's history
    const txRef = db.ref(`users/${uid}/transactions`).push();
    await txRef.set({
      type: 'deposit',
      amount: Number(amount),
      status: 'completed',
      reference: tx_ref,
      createdAt: admin.database.ServerValue.TIMESTAMP,
    });

    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 

// api/webhook.js
const crypto = require('crypto');
const fetch = require('node-fetch');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

module.exports = async (req, res) => {
  // PayChangu requires 200 within seconds — reply first, process after
  res.status(200).json({ received: true });

  try {
    if (req.method !== 'POST') return;

    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['signature'] || req.headers['Signature'];
    const secret = process.env.PAYCHANGU_WEBHOOK_SECRET;

    // 1. verify signature
    if (secret && signature) {
      const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (hash !== signature) {
        console.warn('Invalid webhook signature');
        return;
      }
    }

    const event = req.body;
    const tx_ref = event.tx_ref || event.reference;
    const status = event.status;
    const amount = Number(event.amount);

    if (status !== 'success' || !tx_ref) return;

    // 2. idempotency — already processed?
    const processedRef = db.ref(`processed_tx/${tx_ref}`);
    if ((await processedRef.once('value')).exists()) return;

    // 3. verify with PayChangu (never trust webhook alone)
    const verifyRes = await fetch(
      `https://api.paychangu.com/verify-payment/${tx_ref}`,
      { headers: { Authorization: `Bearer ${process.env.PAYCHANGU_SECRET_KEY}` } }
    ).then(r => r.json());

    if (verifyRes.status !== 'success' || verifyRes.data?.status !== 'success') {
      console.log('Verify failed', tx_ref);
      return;
    }

    const verifiedAmount = Number(verifyRes.data.amount);
    const meta = verifyRes.data.meta || event.meta || {};
    const uid = meta.uid;

    if (!uid || verifiedAmount <= 0) return;

    // 4. check pending deposit
    const pendingRef = db.ref(`pending_deposits/${tx_ref}`);
    const pending = await pendingRef.once('value');
    if (!pending.exists()) {
      console.warn('No pending record for', tx_ref);
      // still credit if meta matches — safety net
    }

    // 5. credit user atomically
    await db.ref(`leaderboard_all/${uid}/mwk`).transaction(current => (current || 0) + verifiedAmount);

    // 6. mark processed
    await processedRef.set({
      uid,
      amount: verifiedAmount,
      creditedAt: Date.now(),
      tx_ref
    });
    await pendingRef.update({ status: 'completed', completedAt: Date.now() });

    console.log(`Credited ${verifiedAmount} MWK to ${uid} (${tx_ref})`);

  } catch (err) {
    console.error('Webhook error:', err);
    // already sent 200, so PayChangu won't retry — log for you to investigate
  }
}; 

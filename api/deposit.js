const fetch = require('node-fetch');
const { admin, db, verifyIdToken } = require('./_lib/firebaseAdmin');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    // 1. Authenticate user via Firebase ID token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Missing or invalid token' });
    }
    const token = authHeader.split('Bearer ')[1];
    const decoded = await verifyIdToken(token);
    const uid = decoded.uid;

    const { amount } = req.body || {};
    const amt = Number(amount);
    if (!amt || amt < 50) {
      return res.status(400).json({ success: false, message: 'Amount must be >= 50 MWK' });
    }

    // 2. Get user data from Realtime DB
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const user = userSnap.val() || {};

    // 3. Unique reference
    const tx_ref = `MADA-${uid}-${Date.now()}`;

    // 4. Save pending deposit record (for idempotency)
    await db.ref(`pending_deposits/${tx_ref}`).set({
      uid,
      amount: amt,
      status: 'pending',
      createdAt: admin.database.ServerValue.TIMESTAMP,
    });

    // 5. Call PayChangu to create payment link
    const payload = {
      amount: String(amt),
      currency: "MWK",
      tx_ref,
      meta: { uid },
      callback_url: "https://madabanda657-netizen.github.io/Mada-checker-earn/", // your frontend URL
      return_url: "https://madabanda657-netizen.github.io/Mada-checker-earn/",
      customization: {
        title: "Mada Game Deposit",
        description: `Deposit MWK ${amt}`
      }
    };
    if (user.email) payload.email = user.email;
    if (user.fullname || user.displayName) payload.first_name = user.fullname || user.displayName;

    const pchRes = await fetch("https://api.paychangu.com/payment", {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const pchData = await pchRes.json();

    if (pchRes.ok && pchData.status === 'success' && pchData.data?.checkout_url) {
      return res.status(200).json({
        success: true,
        checkout_url: pchData.data.checkout_url,
        tx_ref
      });
    }

    // PayChangu error – mark pending as failed
    await db.ref(`pending_deposits/${tx_ref}`).update({ status: 'failed', error: pchData });
    return res.status(400).json({
      success: false,
      message: pchData.message || 'PayChangu error',
      details: pchData
    });

  } catch (err) {
    console.error('Deposit error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}; 

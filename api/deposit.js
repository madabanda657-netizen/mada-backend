// api/deposit.js
const fetch = require('node-fetch');
const admin = require('firebase-admin');

// --- init Firebase once ---
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
  // CORS for your front-end
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false, message:'Method not allowed' });

  try {
    const { uid, amount } = req.body || {};

    // 1. validate
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ success:false, message:'Missing uid' });
    }
    const amt = Number(amount);
    if (!amt || amt < 50) {
      return res.status(400).json({ success:false, message:'Amount must be >= 50 MWK' });
    }

    // 2. get user email (optional, for PayChangu receipt)
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const user = userSnap.val() || {};
    
    // 3. create unique reference
    const tx_ref = `MADA-${uid}-${Date.now()}`;

    // 4. save pending (for idempotency & webhook)
    await db.ref(`pending_deposits/${tx_ref}`).set({
      uid,
      amount: amt,
      status: 'pending',
      createdAt: Date.now()
    });

    // 5. call PayChangu
    const payload = {
      amount: String(amt),
      currency: "MWK",
      tx_ref,
      // pass uid so webhook doesn't need to parse tx_ref
      meta: { uid },
      // browser returns here after payment – your GitHub Pages site
      callback_url: "https://madabanda657-netizen.github.io/Mada-checker-earn/",
      return_url: "https://madabanda657-netizen.github.io/Mada-checker-earn/",
      customization: {
        title: "Mada Game Deposit",
        description: `Deposit MWK ${amt}`
      }
    };
    if (user.email) payload.email = user.email;
    if (user.displayName) payload.first_name = user.displayName;

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

    // PayChangu error – clean up pending
    await db.ref(`pending_deposits/${tx_ref}`).update({ status:'failed', error:pchData });
    return res.status(400).json({
      success: false,
      message: pchData.message || 'PayChangu error',
      details: pchData
    });

  } catch (err) {
    console.error('deposit error', err);
    return res.status(500).json({ success:false, message: err.message });
  }
};

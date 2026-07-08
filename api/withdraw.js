// api/withdraw.js
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

// Get these UUIDs from: GET https://api.paychangu.com/mobile-money/payouts/operators
const OPERATORS = {
  airtel: process.env.AIRTEL_OPERATOR_ID || "20be6c20-adeb-4b5b-a7ba-0769820df4fb", // replace with yours
  tnm: process.env.TNM_OPERATOR_ID || "YOUR_TNM_UUID_HERE"
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ success:false });

  try {
    const { uid, amount } = req.body || {};
    const amt = Number(amount);

    if (!uid ||!amt || amt < 500) {
      return res.status(400).json({ success:false, message:'Minimum withdrawal is MWK 500' });
    }

    // 1. load user & check balance atomically
    const userRef = db.ref(`leaderboard_all/${uid}/mwk`);
    let newBalance;
    const deducted = await userRef.transaction(current => {
      const bal = current || 0;
      if (bal < amt) return; // abort
      newBalance = bal - amt;
      return newBalance;
    });

    if (!deducted.committed) {
      return res.status(400).json({ success:false, message:'Insufficient balance' });
    }

    // 2. get phone
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const user = userSnap.val() || {};
    let phone = (user.phone || '').replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '265' + phone.slice(1);
    if (!phone.startsWith('265')) phone = '265' + phone;

    const network = (phone.startsWith('26599') || phone.startsWith('26598'))? 'airtel' : 'tnm';
    const operatorId = OPERATORS[network];
    if (!operatorId) throw new Error('Operator ID not configured');

    const reference = `MADA-WD-${uid}-${Date.now()}`;

    // 3. save pending payout (idempotency)
    await db.ref(`payouts/${reference}`).set({
      uid, amount: amt, phone, network,
      status: 'pending',
      createdAt: Date.now()
    });

    // 4. call PayChangu correct endpoint
    const pchRes = await fetch("https://api.paychangu.com/mobile-money/payouts/initialize", {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        mobile: phone,
        mobile_money_operator_ref_id: operatorId,
        amount: String(amt),
        charge_id: reference,
        email: user.email || undefined,
        first_name: uid
      })
    });

    const pchData = await pchRes.json();

    if (pchRes.ok && pchData.status === 'success') {
      await db.ref(`payouts/${reference}`).update({ status:'sent', pch: pchData, sentAt: Date.now() });
      return res.json({ success:true, message:`MWK ${amt} sent to ${phone}`, reference });
    }

    // 5. failed – refund
    await userRef.transaction(cur => (cur || 0) + amt);
    await db.ref(`payouts/${reference}`).update({ status:'failed', error: pchData, failedAt: Date.now() });

    const errMsg = pchData.message || pchData.errorMessage || 'Payout rejected';
    return res.status(400).json({ success:false, message: errMsg });

  } catch (err) {
    console.error('withdraw error', err);
    return res.status(500).json({ success:false, message: err.message });
  }
}; 

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

// IDs you just fetched live from PayChangu
const OPERATORS = {
  airtel: "20be6c20-adeb-4b5b-a7ba-0769820df4fb",
  tnm: "27494cb5-ba9e-437f-a114-4e7a7686bcca"
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false });

  try {
    const { uid, amount } = req.body || {};
    const amt = Number(amount);

    // set to 50 for testing, later you can change to 500
    if (!uid || !amt || amt < 50) {
      return res.status(400).json({ success:false, message:'Minimum withdrawal is MWK 50' });
    }

    // 1. check balance from leaderboard_all
    const balRef = db.ref(`leaderboard_all/${uid}/mwk`);
    const balSnap = await balRef.once('value');
    const bal = balSnap.val() || 0;
    if (bal < amt) {
      return res.status(400).json({ success:false, message:`Insufficient balance. You have MWK ${bal}` });
    }

    // 2. deduct BOTH places to keep in sync
    await db.ref(`leaderboard_all/${uid}/mwk`).transaction(v => (v||0) - amt);
    await db.ref(`users/${uid}/mwk`).transaction(v => (v||0) - amt);

    // 3. get phone
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const user = userSnap.val() || {};
    let phone = (user.phone || '').replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '265' + phone.slice(1);
    if (!phone.startsWith('265')) phone = '265' + phone;

    const isAirtel = phone.startsWith('26599') || phone.startsWith('26598');
    const network = isAirtel ? 'airtel' : 'tnm';
    const operatorId = OPERATORS[network];

    const reference = `MADA-WD-${uid}-${Date.now()}`;

    await db.ref(`payouts/${reference}`).set({
      uid, amount: amt, phone, network,
      status: 'pending',
      createdAt: Date.now()
    });

    // 4. PayChangu payout - use your Vercel env name
    const secret = process.env.PAYCHANGU_SECRET_KEY || process.env.PAYCHANGU_SECRET;
    const pchRes = await fetch("https://api.paychangu.com/mobile-money/payouts/initialize", {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        mobile: phone,
        mobile_money_operator_ref_id: operatorId,
        amount: String(amt),
        charge_id: reference
      })
    });

    const pchData = await pchRes.json();
    console.log("Payout", reference, pchData);

    if (pchRes.ok && pchData.status === 'success') {
      await db.ref(`payouts/${reference}`).update({ status:'sent', pch: pchData, sentAt: Date.now() });
      return res.json({ success:true, message:`MWK ${amt} sent to ${phone}`, reference });
    }

    // 5. failed – refund BOTH
    await db.ref(`leaderboard_all/${uid}/mwk`).transaction(v => (v||0) + amt);
    await db.ref(`users/${uid}/mwk`).transaction(v => (v||0) + amt);
    await db.ref(`payouts/${reference}`).update({ status:'failed', error: pchData, failedAt: Date.now() });

    return res.status(400).json({ success:false, message: pchData.message || 'Payout rejected' });

  } catch (err) {
    console.error('withdraw error', err);
    return res.status(500).json({ success:false, message: err.message });
  }
}; 

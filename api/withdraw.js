const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

const OPERATORS = {
  airtel: process.env.AIRTEL_OPERATOR_ID || "20be6c20-adeb-4b5b-a7ba-0769820df4fb",
  tnm: process.env.TNM_OPERATOR_ID || "27494cb5-69a3-4dc2-9417-b5502dfa6e57"
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ success:false, message:'POST only' });

  const { uid, amount } = req.body || {};
  const amt = Number(amount);
  if (!uid ||!amt || amt < 50) return res.status(400).json({ success:false, message:'Min withdraw 50' });

  let deducted = false;
  let lbBefore = 0;
  let userBefore = 0;

  try {
    // CHECK users/ - master wallet
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const userData = userSnap.val();
    if (!userData) return res.status(404).json({ success:false, message:'User not found' });

    userBefore = Number(userData.mwk || 0);
    const lbSnap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');
    lbBefore = Number(lbSnap.val() || 0);

    if (userBefore < amt) {
      return res.status(400).json({ success:false, message:`Not enough. Balance MWK ${userBefore}` });
    }

    // DEDUCT both
    await db.ref(`users/${uid}/mwk`).set(userBefore - amt);
    await db.ref(`leaderboard_all/${uid}/mwk`).set(Math.max(0, lbBefore - amt));
    deducted = true;

    let phone = (userData.phone || '').replace(/\D/g,'');
    if (!phone) phone = '0998699334';
    if (phone.startsWith('0')) phone = '265' + phone.slice(1);
    if (!phone.startsWith('265')) phone = '265' + phone;

    const isAirtel = phone.startsWith('26599') || phone.startsWith('26598');
    const operatorId = isAirtel? OPERATORS.airtel : OPERATORS.tnm;
    if (!operatorId) throw new Error('Operator ID not configured');

    const refId = `MADA-WD-${uid}-${Date.now()}`;

    // TRY AUTO PayChangu
    try {
      const pResp = await fetch('https://api.paychangu.com/mobile-money/payouts/initialize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          mobile: phone,
          mobile_money_operator_ref_id: operatorId,
          amount: String(amt),
          charge_id: refId
        })
      });
      const pData = await pResp.json().catch(()=>({}));

      if (pResp.ok && (pData.status === 'success' || pData.data)) {
        await db.ref(`withdraw_requests/${refId}`).set({
          uid, amount: amt, phone, network: isAirtel?'Airtel Money':'TNM Mpamba',
          status: 'sent', paychangu_ref: pData.data?.data?.ref_id || refId, createdAt: Date.now()
        });
        return res.json({ success:true, auto:true, message:`MWK ${amt} sent to ${phone}` });
      }

      // AUTO FAILED -> MANUAL FALLBACK, NO REFUND
      const errMsg = typeof pData.message === 'string'? pData.message : JSON.stringify(pData.message || pData);
      console.log('Auto failed, switching to manual:', errMsg);

      await db.ref(`withdraw_requests/${refId}`).set({
        uid, amount: amt, phone, network: isAirtel?'Airtel Money':'TNM Mpamba',
        status: 'pending_manual', paychangu_error: errMsg, createdAt: Date.now()
      });
      return res.json({ success:true, manual:true, message:`Request received. Admin will send MWK ${amt} within 1 hour`, reference: refId });

    } catch (autoErr) {
      // Network error -> manual fallback too
      await db.ref(`withdraw_requests/${refId}`).set({
        uid, amount: amt, phone, network: isAirtel?'Airtel Money':'TNM Mpamba',
        status: 'pending_manual', error: autoErr.message, createdAt: Date.now()
      });
      return res.json({ success:true, manual:true, message:`Request received. Admin will send MWK ${amt}` });
    }

  } catch (err) {
    // ONLY refund on critical error before payout
    if (deducted) {
      await db.ref(`users/${uid}/mwk`).set(userBefore);
      await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore);
    }
    console.error('Withdraw error', err);
    return res.status(500).json({ success:false, message: String(err.message || err) });
  }
}; 

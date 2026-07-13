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
  if (req.method !== 'POST') return res.status(405).json({ success:false, message:'POST only' });

  const { uid, amount } = req.body || {};
  const amt = Number(amount);
  if (!uid || !amt || amt < 50) return res.status(400).json({ success:false, message:'Min withdraw 50' });

  let deducted = false;
  let lbBefore = 0;
  let userBefore = 0;

  try {
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const userData = userSnap.val();
    if (!userData) return res.status(404).json({ success:false, message:'User not found' });

    // GET USER PHONE - works for every user, not only you
    let rawPhone = (userData.phone || userData.phoneNumber || '').toString().replace(/\D/g,'');
    if (!rawPhone) {
      return res.status(400).json({ success:false, message:'No phone number on profile. Please update phone in Profile.' });
    }

    userBefore = Number(userData.mwk || 0);
    const lbSnap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');
    lbBefore = Number(lbSnap.val() || 0);

    if (userBefore < amt) {
      return res.status(400).json({ success:false, message:`Not enough. Balance MWK ${userBefore}` });
    }

    // DEDUCT
    await db.ref(`users/${uid}/mwk`).set(userBefore - amt);
    await db.ref(`leaderboard_all/${uid}/mwk`).set(Math.max(0, lbBefore - amt));
    deducted = true;

    // --- FIXED: Normalize to both formats ---
    let intl = rawPhone;
    if (intl.startsWith('0')) intl = '265' + intl.slice(1);
    if (intl.startsWith('+265')) intl = intl.slice(1);
    if (!intl.startsWith('265')) intl = '265' + intl;

    // PayChangu wants 0 + 9 digits, e.g. 0998699334
    let local = intl;
    if (local.startsWith('265')) local = '0' + local.slice(3);

    if (local.length !== 10) {
      throw new Error(`Invalid phone format: ${local}. Expected 0XXXXXXXXX`);
    }

    // Operator detection for Malawi
    // TNM = 088, 0887 | Airtel = 099, 098, 089
    const isTnm = intl.startsWith('26588');
    const isAirtel = !isTnm; 
    const operatorId = isTnm ? OPERATORS.tnm : OPERATORS.airtel;
    const networkName = isTnm ? 'TNM Mpamba' : 'Airtel Money';

    if (!operatorId) throw new Error('Operator ID not configured');

    const refId = `MADA-WD-${uid}-${Date.now()}`;

    // TRY AUTO
    try {
      const pResp = await fetch('https://api.paychangu.com/mobile-money/payouts/initialize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          mobile: local, // <-- FIXED: send 099... not 265...
          mobile_money_operator_ref_id: operatorId,
          amount: String(amt),
          charge_id: refId
        })
      });
      
      const pData = await pResp.json().catch(()=>({}));
      console.log('PayChangu raw response:', JSON.stringify(pData));

      if (pResp.ok && (pData.status === 'success' || pData.data)) {
        await db.ref(`withdraw_requests/${refId}`).set({
          uid, amount: amt, phone: local, intl_phone: intl, network: networkName,
          status: 'sent', paychangu_ref: pData.data?.data?.ref_id || refId, createdAt: Date.now()
        });
        return res.json({ success:true, auto:true, message:`MWK ${amt} sent to ${local}` });
      }

      // Auto failed -> REFUND so user can retry, and show real reason
      const errMsg = pData.message ? JSON.stringify(pData.message) : JSON.stringify(pData);
      console.log('Auto failed:', errMsg);

      // REFUND for auto fail during testing
      await db.ref(`users/${uid}/mwk`).set(userBefore);
      await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore);
      deducted = false;

      await db.ref(`withdraw_requests/${refId}`).set({
        uid, amount: amt, phone: local, network: networkName,
        status: 'failed', paychangu_error: errMsg, createdAt: Date.now()
      });
      return res.status(400).json({ success:false, message:`PayChangu rejected: ${errMsg}` });

    } catch (autoErr) {
      if (deducted) {
        await db.ref(`users/${uid}/mwk`).set(userBefore);
        await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore);
      }
      console.error('Auto exception', autoErr);
      return res.status(500).json({ success:false, message: autoErr.message });
    }

  } catch (err) {
    if (deducted) {
      await db.ref(`users/${uid}/mwk`).set(userBefore);
      await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore);
    }
    console.error('Withdraw error', err);
    return res.status(500).json({ success:false, message: String(err.message || err) });
  }
};

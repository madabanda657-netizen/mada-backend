const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

const AIRTEL_REAL = "20be6c20-adeb-4b5b-a7ba-0769820df4fb";
let cachedOps = null;
async function getLiveTNM() {
  if (cachedOps) return cachedOps;
  const r = await fetch('https://api.paychangu.com/mobile-money', {
    headers: { 'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}` }
  });
  const j = await r.json();
  cachedOps = j.data || j;
  return cachedOps.find(o => o.name.toLowerCase().includes('tnm') || o.name.toLowerCase().includes('mpamba'));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ success:false, message:'POST only' });

  const { uid, amount } = req.body || {};
  const amt = Number(amount);
  if (!uid ||!amt || amt < 50) return res.status(400).json({ success:false, message:'Min withdraw 50' });

  let deducted = false, lbBefore = 0, userBefore = 0;

  try {
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const userData = userSnap.val();
    if (!userData) return res.status(404).json({ success:false, message:'User not found' });

    userBefore = Number(userData.mwk || 0);
    const lbSnap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');
    lbBefore = Number(lbSnap.val() || 0);
    if (userBefore < amt) return res.status(400).json({ success:false, message:`Not enough. Balance MWK ${userBefore}` });

    let raw = (userData.phone || '').toString().replace(/\D/g,'');
    if (!raw) return res.status(400).json({ success:false, message:'No phone in profile' });
    
    let intl = raw;
    if (intl.startsWith('0')) intl = '265' + intl.slice(1);
    if (!intl.startsWith('265')) intl = '265' + intl;
    const local = '0' + intl.slice(3); // PayChangu needs 088... not 26588...

    await db.ref(`users/${uid}/mwk`).set(userBefore - amt);
    await db.ref(`leaderboard_all/${uid}/mwk`).set(Math.max(0, lbBefore - amt));
    deducted = true;

    const isAirtel = intl.startsWith('26599') || intl.startsWith('26598');
    let operatorId = AIRTEL_REAL;
    if (!isAirtel) {
      const tnmLive = await getLiveTNM();
      operatorId = tnmLive ? tnmLive.ref_id : process.env.TNM_OPERATOR_ID;
    }

    const refId = `MADA-WD-${uid}-${Date.now()}`;

    try {
      const pResp = await fetch('https://api.paychangu.com/mobile-money/payouts/initialize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mobile: local,
          mobile_money_operator_ref_id: operatorId,
          amount: String(amt),
          charge_id: refId
        })
      });
      const pData = await pResp.json().catch(()=>({}));
      if (pResp.ok && (pData.status === 'success' || pData.data)) {
        await db.ref(`withdraw_requests/${refId}`).set({
          uid, amount: amt, phone: local, network: isAirtel?'Airtel':'TNM',
          status: 'sent', createdAt: Date.now()
        });
        return res.json({ success:true, auto:true, message:`MWK ${amt} sent to ${local}` });
      }
      throw new Error(JSON.stringify(pData.message || pData));
    } catch (autoErr) {
      await db.ref(`withdraw_requests/${refId}`).set({
        uid, amount: amt, phone: local, network: isAirtel?'Airtel':'TNM',
        status: 'pending_manual', error: autoErr.message, createdAt: Date.now()
      });
      return res.json({ success:true, manual:true, message:`Request received. Admin will send MWK ${amt} within 1 hour`, reference: refId });
    }

  } catch (err) {
    if (deducted) {
      await db.ref(`users/${uid}/mwk`).set(userBefore);
      await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore);
    }
    return res.status(500).json({ success:false, message: err.message });
  }
};

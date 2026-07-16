const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

let cachedOps = null;
async function getLiveOperators() {
  if (cachedOps) return cachedOps;
  const res = await fetch('https://api.paychangu.com/mobile-money', {
    headers: { 'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}` }
  });
  const json = await res.json();
  console.log('LIVE OPERATORS FROM PAYCHANGU:', JSON.stringify(json));
  cachedOps = json.data || json;
  return cachedOps;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ success:false });

  const { uid, amount } = req.body || {};
  const amt = Number(amount);
  if (!uid ||!amt) return res.status(400).json({ success:false, message:'Invalid' });

  let userBefore=0, lbBefore=0, deducted=false;
  try {
    const snap = await db.ref(`users/${uid}`).once('value');
    const user = snap.val();
    if (!user) return res.status(404).json({ success:false, message:'User not found' });

    // EVERY USER uses HIS OWN phone, not yours
    let raw = (user.phone || user.phoneNumber || '').replace(/\D/g,'');
    if (!raw) return res.status(400).json({ success:false, message:'No phone in profile' });

    userBefore = Number(user.mwk||0);
    const lbSnap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');
    lbBefore = Number(lbSnap.val()||0);
    if (userBefore < amt) return res.status(400).json({ success:false, message:`Balance ${userBefore}` });

    await db.ref(`users/${uid}/mwk`).set(userBefore - amt);
    await db.ref(`leaderboard_all/${uid}/mwk`).set(Math.max(0, lbBefore - amt));
    deducted=true;

    let intl = raw;
    if (intl.startsWith('0')) intl = '265'+intl.slice(1);
    if (intl.startsWith('+265')) intl = intl.slice(1);
    if (!intl.startsWith('265')) intl = '265'+intl;
    let local = '0'+intl.slice(3); // 099...

    const operators = await getLiveOperators();
    const airtel = operators.find(o => o.name.toLowerCase().includes('airtel'));
    const tnm = operators.find(o => o.name.toLowerCase().includes('tnm') || o.name.toLowerCase().includes('mpamba'));

    const isTnm = intl.startsWith('26588');
    const chosen = isTnm? tnm : airtel;
    if (!chosen) throw new Error('No operator found - check logs');

    console.log(`Sending ${amt} to ${local} via ${chosen.name} ${chosen.ref_id}`);

    const refId = `MADA-WD-${uid}-${Date.now()}`;
    const pRes = await fetch('https://api.paychangu.com/mobile-money/payouts/initialize', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PAYCHANGU_SECRET_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ mobile: local, mobile_money_operator_ref_id: chosen.ref_id, amount: String(amt), charge_id: refId })
    });
    const pData = await pRes.json();
    console.log('PayChangu:', JSON.stringify(pData));

    if (pRes.ok && (pData.status==='success' || pData.data)) {
      await db.ref(`withdraw_requests/${refId}`).set({ uid, amount:amt, phone:local, network:chosen.name, status:'sent', createdAt:Date.now() });
      return res.json({ success:true, auto:true, message:`MWK ${amt} sent to ${local}` });
    }
    throw new Error(JSON.stringify(pData.message || pData));

  } catch (e) {
    if (deducted) {
      await db.ref(`users/${uid}/mwk`).set(userBefore);
      await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore);
    }
    console.error(e);
    return res.status(400).json({ success:false, message:`PayChangu rejected: ${e.message}. Balance refunded.` });
  }
}; 

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

const HARDCODED_OPERATORS = {
  airtel: process.env.AIRTEL_OPERATOR_ID || "20be6c20-adeb-4b5b-a7ba-0769820df4fb",
  tnm: process.env.TNM_OPERATOR_ID || "27494cb5-69a3-4dc2-9417-b5502dfa6e57"
};

// Function to fetch the correct operator ID if the hardcoded ones fail
async function getOperatorId(isTnm, forceFetch = false) {
  if (!forceFetch) {
    if (isTnm && HARDCODED_OPERATORS.tnm) return HARDCODED_OPERATORS.tnm;
    if (!isTnm && HARDCODED_OPERATORS.airtel) return HARDCODED_OPERATORS.airtel;
  }
  
  console.log(`Fetching fresh operator ID from PayChangu for ${isTnm ? 'TNM' : 'Airtel'}...`);
  const res = await fetch('https://api.paychangu.com/mobile-money/operators', {
    headers: { 'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`, 'Accept': 'application/json' }
  });
  const data = await res.json();
  const ops = data.data || data;
  
  if (!ops || ops.length === 0) throw new Error('Could not fetch operators from PayChangu API.');

  // Filter strictly for Malawi to avoid grabbing Tanzania/Nigeria IDs
  const mwOps = ops.filter(o => {
    const s = JSON.stringify(o).toLowerCase();
    return s.includes('malawi') || s.includes('"mw"') || s.includes('mw_');
  });
  
  const searchPool = mwOps.length > 0 ? mwOps : ops;
  const opName = isTnm ? 'tnm' : 'airtel';
  
  const found = searchPool.find(o => JSON.stringify(o).toLowerCase().includes(opName));
  if (!found) throw new Error(`Could not find ${opName} Malawi in PayChangu list. Available: ${JSON.stringify(ops).substring(0, 500)}`);
  
  const id = found.ref_id || found.id || found.operator_id || found.uuid || found.code;
  if (!id) throw new Error(`Found ${opName} but no ID field. Data: ${JSON.stringify(found)}`);
  
  return String(id);
}

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

    let rawPhone = (userData.phone || userData.phoneNumber || '').toString().replace(/\D/g,'');
    if (!rawPhone) {
      return res.status(400).json({ success:false, message:'No phone number on profile. Please update phone in Profile.' });
    }

    userBefore = Number(userData.mwk || 0);
    const lbSnap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');
    lbBefore = Number(lbSnap.val() || 0);

    let actualBalance = Math.max(userBefore, lbBefore);
    if (actualBalance < amt) {
      return res.status(400).json({ success:false, message:`Not enough. Balance MWK ${actualBalance}` });
    }

    // DEDUCT
    await db.ref(`users/${uid}/mwk`).set(actualBalance - amt);
    await db.ref(`leaderboard_all/${uid}/mwk`).set(Math.max(0, lbBefore - amt));
    deducted = true;

    // Format phone
    let intl = rawPhone;
    if (intl.startsWith('0')) intl = '265' + intl.slice(1);
    if (intl.startsWith('+265')) intl = intl.slice(1);
    if (!intl.startsWith('265')) intl = '265' + intl;

    let local = intl.startsWith('265') ? '0' + intl.slice(3) : intl;
    if (!local.startsWith('0')) local = '0' + local;
    if (local.length !== 10) throw new Error(`Invalid phone format: ${local}. Expected 0XXXXXXXXX`);

    const isTnm = intl.startsWith('26588') || intl.startsWith('26589');
    const networkName = isTnm ? 'TNM Mpamba' : 'Airtel Money';

    const refId = `MADA-WD-${uid}-${Date.now()}`;
    
    // 1st attempt: Use hardcoded ID
    let operatorId = await getOperatorId(isTnm, false);
    let pResp;
    let pData;

    pResp = await fetch('https://api.paychangu.com/mobile-money/payouts/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        mobile: local,
        mobile_money_operator_ref_id: String(operatorId),
        amount: String(amt),
        charge_id: refId
      })
    });
    pData = await pResp.json().catch(()=>({}));
    console.log('PayChangu attempt 1 (Hardcoded ID):', JSON.stringify(pData));

    // 2nd attempt: If operator not found, fetch fresh ID and retry!
    if (!pResp.ok || (pData.status !== 'success' && !pData.data)) {
      const errStr = JSON.stringify(pData).toLowerCase();
      if (errStr.includes('operator not found') || errStr.includes('invalid operator')) {
        console.log('Hardcoded ID failed. Fetching dynamic ID...');
        operatorId = await getOperatorId(isTnm, true); // forceFetch = true
        
        pResp = await fetch('https://api.paychangu.com/mobile-money/payouts/initialize', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            mobile: local,
            mobile_money_operator_ref_id: String(operatorId),
            amount: String(amt),
            charge_id: refId
          })
        });
        pData = await pResp.json().catch(()=>({}));
        console.log('PayChangu attempt 2 (Dynamic ID):', JSON.stringify(pData));
      }
    }

    // Check if success after retries
    if (pResp.ok && (pData.status === 'success' || pData.data)) {
      await db.ref(`withdraw_requests/${refId}`).set({
        uid, amount: amt, phone: local, intl_phone: intl, network: networkName,
        status: 'sent', paychangu_ref: pData.data?.data?.ref_id || refId, createdAt: Date.now()
      });
      return res.json({ success:true, auto:true, message:`MWK ${amt} sent to ${local}` });
    }

    // If still failed, refund and show error
    const errMsg = pData.message ? JSON.stringify(pData.message) : JSON.stringify(pData);
    console.log('Final fail:', errMsg);

    await db.ref(`users/${uid}/mwk`).set(actualBalance);
    await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore);
    deducted = false;

    await db.ref(`withdraw_requests/${refId}`).set({
      uid, amount: amt, phone: local, network: networkName,
      status: 'failed', paychangu_error: errMsg, createdAt: Date.now()
    });
    return res.status(400).json({ success:false, message:`PayChangu rejected: ${errMsg}` });

  } catch (err) {
    if (deducted) {
      await db.ref(`users/${uid}/mwk`).set(userBefore);
      await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore);
    }
    console.error('Withdraw error', err);
    return res.status(500).json({ success:false, message: String(err.message || err) });
  }
}; 

const fetch = require('node-fetch');
const { admin, db, verifyIdToken } = require('./_lib/firebaseAdmin');

// Cache operators for 10 minutes
let cachedOps = null;
let cachedOpsTime = 0;

async function getLiveOperators() {
  const now = Date.now();
  if (cachedOps && (now - cachedOpsTime) < 600000) return cachedOps;
  const res = await fetch('https://api.paychangu.com/mobile-money', {
    headers: {
      'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
      'Accept': 'application/json'
    }
  });
  const json = await res.json();
  console.log('LIVE OPERATORS FROM PAYCHANGU:', JSON.stringify(json));
  cachedOps = json.data || json;
  cachedOpsTime = now;
  return cachedOps;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    // 1. Authenticate user
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
      return res.status(400).json({ success: false, message: 'Minimum withdrawal is 50 MWK' });
    }

    // 2. Get user data
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const user = userSnap.val();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 3. Get phone number from profile
    const rawPhone = (user.mobile || user.phone || user.phoneNumber || '').replace(/\D/g, '');
    if (!rawPhone) {
      return res.status(400).json({ success: false, message: 'No phone number in profile' });
    }

    // 4. Check balance
    const currentBalance = user.balance || 0;
    if (currentBalance < amt) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Balance: ${currentBalance}` });
    }

    // 5. Prepare phone number for PayChangu (international format)
    let intl = rawPhone;
    if (intl.startsWith('0')) intl = '265' + intl.slice(1);
    if (intl.startsWith('+265')) intl = intl.slice(1);
    if (!intl.startsWith('265')) intl = '265' + intl;
    const local = '0' + intl.slice(3); // e.g., 099...

    // 6. Fetch operators and select the correct one (Airtel or TNM)
    const operators = await getLiveOperators();
    const airtel = operators.find(o => o.name && o.name.toLowerCase().includes('airtel'));
    const tnm = operators.find(o => o.name && (o.name.toLowerCase().includes('tnm') || o.name.toLowerCase().includes('mpamba')));

    // Determine network by prefix (Airtel: 26599? Actually check your prefix)
    // For Malawi: Airtel often starts with 099, TNM with 088. Use your own logic.
    const isTnm = intl.startsWith('26588') || intl.startsWith('26577'); // adjust as needed
    const chosen = isTnm ? tnm : airtel;

    if (!chosen) {
      throw new Error('No mobile money operator found - check PayChangu response');
    }

    console.log(`Sending ${amt} MWK to ${local} via ${chosen.name} (${chosen.ref_id})`);

    // 7. Deduct balance atomically
    let deducted = false;
    const userRef = db.ref(`users/${uid}`);
    await userRef.transaction((current) => {
      if (current === null) return null;
      const balance = current.balance || 0;
      if (balance < amt) return undefined; // abort
      current.balance = balance - amt;
      deducted = true;
      return current;
    });

    // Check if transaction succeeded
    const afterSnap = await userRef.once('value');
    if (!afterSnap.exists() || afterSnap.val().balance === undefined) {
      // If failed, rethrow
      throw new Error('Balance deduction failed');
    }

    // 8. Call PayChangu to send money
    const refId = `MADA-WD-${uid}-${Date.now()}`;
    const pRes = await fetch('https://api.paychangu.com/mobile-money/payouts/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mobile: local,
        mobile_money_operator_ref_id: chosen.ref_id,
        amount: String(amt),
        charge_id: refId
      })
    });

    const pData = await pRes.json();
    console.log('PayChangu payout response:', JSON.stringify(pData));

    if (pRes.ok && (pData.status === 'success' || pData.data)) {
      // Success – record withdrawal
      await db.ref(`withdraw_requests/${refId}`).set({
        uid,
        amount: amt,
        phone: local,
        network: chosen.name,
        status: 'sent',
        createdAt: admin.database.ServerValue.TIMESTAMP,
      });
      await db.ref(`users/${uid}/transactions`).push({
        type: 'withdraw',
        amount: amt,
        status: 'completed',
        reference: refId,
        createdAt: admin.database.ServerValue.TIMESTAMP,
      });
      return res.status(200).json({
        success: true,
        message: `MWK ${amt} sent to ${local}`,
        newBalance: afterSnap.val().balance
      });
    } else {
      // PayChangu error – revert balance
      await userRef.transaction((current) => {
        if (current === null) return null;
        current.balance = (current.balance || 0) + amt;
        return current;
      });
      throw new Error(pData.message || 'PayChangu payout failed');
    }

  } catch (err) {
    console.error('Withdraw error:', err.message);
    return res.status(400).json({
      success: false,
      message: err.message || 'Withdrawal failed'
    });
  }
}; 

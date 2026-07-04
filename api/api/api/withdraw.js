// payout.js  — Pawapay V2 Payout (Malawi)
const fetch = require('node-fetch');
const admin = require('firebase-admin');
const { randomUUID } = require('crypto');

module.exports = async (req, res) => {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const { uid, amount } = req.body || {};

    // 1. Validate input
    if (!uid) return res.status(400).json({ success: false, message: 'Missing uid' });
    const amt = Math.round(Number(amount));
    if (!amt || amt < 50) return res.status(400).json({ success: false, message: 'Minimum withdrawal is 50 MWK' });

    // 2. Init Firebase once
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        databaseURL: 'https://apple-green-ded09-default-rtdb.firebaseio.com'
      });
    }
    const db = admin.database();

    // 3. Get registered phone (YOUR SECURITY RULE)
    const snap = await db.ref(`users/${uid}`).once('value');
    const user = snap.val();
    if (!user?.phone) return res.status(400).json({ success: false, message: 'No registered phone on file' });

    // 4. Clean phone to 265XXXXXXXXX
    let phone = String(user.phone).replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '265' + phone.slice(1);
    if (!phone.startsWith('265')) phone = '265' + phone;

    // 5. Detect provider for Malawi
    const isAirtel = phone.startsWith('26599') || phone.startsWith('26598') || phone.startsWith('26588');
    const provider = isAirtel ? 'AIRTEL_MWI' : 'TNM_MWI';

    // 6. Build V2 payload
    const payoutId = randomUUID(); // must be UUID v4
    const payload = {
      payoutId,
      amount: String(amt),          // no decimals for MWK
      currency: 'MWK',
      recipient: {
        type: 'MMO',                // V2 requires MMO, not MSISDN
        accountDetails: {
          phoneNumber: phone,
          provider                     // moved inside accountDetails
        }
      },
      customerMessage: 'Mada Game Withdrawal',
      metadata: [{ uid, isPII: true }] // helps you trace in dashboard
    };

    // 7. Call Pawapay (SANDBOX - change to api.pawapay.io for live)
    const PAWAPAY_URL = 'https://api.sandbox.pawapay.io/v2/payouts';
    const resp = await fetch(PAWAPAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAWAPAY_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    console.log('PawaPay payout:', resp.status, text); // <— check logs

    let data;
    try { data = JSON.parse(text); } 
    catch { return res.status(502).json({ success: false, message: 'Invalid response from Pawapay' }); }

    // 8. Handle response
    if (resp.ok && ['ACCEPTED', 'SUBMITTED'].includes(data.status)) {
      // optional: deduct balance here, or wait for webhook
      return res.status(200).json({ 
        success: true, 
        message: 'Withdrawal sent to your registered number',
        payoutId,
        phone
      });
    }

    // Pawapay rejected
    const reason = data.failureReason?.failureMessage || data.message || text;
    return res.status(400).json({ success: false, message: `Pawapay: ${reason}`, payoutId });

  } catch (err) {
    console.error('Payout error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

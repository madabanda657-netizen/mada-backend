const fetch = require('node-fetch');
const admin = require('firebase-admin');
const { randomUUID } = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { uid, amount } = req.body;
    if (!uid) return res.status(400).json({ success: false, message: "No UID" });

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
      });
    }
    const user = (await admin.database().ref(`users/${uid}`).once('value')).val() || {};

    let phone = String(user.phone || '').replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '265' + phone.slice(1);
    if (!phone.startsWith('265')) phone = '265' + phone;

    const isAirtel = phone.startsWith('26599') || phone.startsWith('26598') || phone.startsWith('26588');
    const provider = isAirtel? 'AIRTEL_MWI' : 'TNM_MWI';

    const payoutId = randomUUID();
    const amountStr = String(Math.round(Number(amount)));

    const resPawa = await fetch('https://api.sandbox.pawapay.io/v2/payouts', {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${process.env.PAWAPAY_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        payoutId,
        amount: amountStr,
        currency: "MWK",
        recipient: {
          type: "MMO",
          accountDetails: {
            phoneNumber: phone,
            provider
          }
        },
        customerMessage: "Mada Game Withdrawal"
      })
    });

    const data = await resPawa.json();
    if (resPawa.ok && (data.status === 'ACCEPTED' || data.status === 'SUBMITTED')) {
      return res.json({ success: true, message: "Withdrawal sent!" });
    }
    const err = data.failureReason || data.errors?.[0];
    return res.status(400).json({ success: false, message: err?.failureMessage || JSON.stringify(data) });

  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}; 

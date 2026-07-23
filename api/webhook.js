const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method!== 'POST') return res.status(200).send('OK');

  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['signature'] || req.headers['x-paychangu-signature'] || '';
    const secret = process.env.PAYCHANGU_SECRET_KEY || '';

    // verify if signature present
    if (signature && secret) {
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (signature!== expected) console.log('WARN: signature mismatch but continuing for MW');
    }

    const event = req.body;
    const data = event.data || event;

    // only credit on success
    const status = (data.status || data.payment_status || '').toLowerCase();
    if (status &&!['success','successful','completed','paid'].includes(status)) {
      return res.json({ received: true, ignored: status });
    }

    const amount = Number(data.amount || data.charged_amount || 0);
    if (!amount || amount < 50) return res.json({ received: true, ignored: 'small amount' });

    const tx_ref = data.tx_ref || data.reference || data.flw_ref || `MADA-${Date.now()}`;
    const paychanguRef = data.reference || data.tx_ref || tx_ref;

    // avoid double credit
    const exists = await db.ref(`deposits/${tx_ref}`).once('value');
    if (exists.exists()) return res.json({ received: true, duplicate: true });

    // find UID: custom field -> name -> phone
    let foundUid = null;
    if (data.customization && data.customization.title) {
      const m = data.customization.title.match(/Mada_([A-Za-z0-9_]+)/);
      if (m) foundUid = m[1];
    }
    if (!foundUid && data.meta && data.meta.uid) foundUid = data.meta.uid;
    if (!foundUid && data.customer && data.customer.first_name) {
      const clean = data.customer.first_name.replace(/[^A-Za-z0-9_]/g,'');
      if (clean) foundUid = clean;
    }

    // fallback phone search
    if (!foundUid) {
      const email = (data.customer?.email || '').toLowerCase();
      const m = email.match(/(\d{9,12})@mada\.mw/);
      let phoneSearch = m? m[1] : (data.customer?.phone || '').replace(/\D/g,'');
      if (phoneSearch) {
        if (phoneSearch.startsWith('265')) phoneSearch = '0' + phoneSearch.slice(3);
        const allUsers = await db.ref('users').once('value');
        allUsers.forEach(c => {
          const u = c.val(); if (u.phone && u.phone.replace(/\D/g,'').endsWith(phoneSearch.slice(-9))) foundUid = c.key;
        });
      }
    }

    if (!foundUid) {
      await db.ref(`unmatched_payments/${tx_ref}`).set({ amount, raw: data, at: Date.now() });
      return res.json({ received: true, unmatched: true });
    }

    // bonus
    const bonusMap = { 150:0, 500:100, 1000:300, 5000:1200 };
    const bonus = bonusMap[amount] || 0;
    const finalToCredit = amount + bonus;

    // MASTER WRITE: BOTH places
    await db.ref(`users/${foundUid}/mwk`).transaction(v => (Number(v)||0) + finalToCredit);
    await db.ref(`leaderboard_all/${foundUid}/mwk`).transaction(v => (Number(v)||0) + finalToCredit);

    await db.ref(`deposits/${tx_ref}`).set({
      uid: foundUid, amount, bonus, finalToCredit,
      paychanguRef, network: data.currency || 'MWK',
      status: 'completed', createdAt: Date.now(), raw: data
    });

    await db.ref(`users/${foundUid}/inbox`).push({
      title: 'Deposit Successful', message: `MWK ${amount} credited. ${bonus?`Bonus MWK ${bonus}!`:''} New balance MWK ${finalToCredit}`, at: Date.now()
    });

    console.log(`LIVE CREDIT ${foundUid} +${finalToCredit}`);
    return res.json({ success: true, uid: foundUid, credited: finalToCredit });

  } catch (e) {
    console.error('Webhook error', e);
    return res.status(500).json({ error: e.message });
  }
}; 

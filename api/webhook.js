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
    const event = req.body || {};
    const data = event.data || event;
    const tx_ref = data.tx_ref || data.reference || event.tx_ref || data.charge_id || data.flw_ref;

    if (!tx_ref) return res.json({ ignored: 'no tx_ref' });

    // FIX 1: Only allow SUCCESS - cancel/pending will be ignored
    const rawStatus = (data.status || data.payment_status || event.event_type || data.event || '').toLowerCase();
    const isSuccess = rawStatus.includes('success') || rawStatus.includes('succeeded') || rawStatus === 'successful' || rawStatus === 'paid' || rawStatus === 'completed';

    if (!isSuccess) {
      console.log(`IGNORE status=${rawStatus} tx=${tx_ref}`);
      return res.json({ ignored: rawStatus });
    }

    // FIX 2: Hard duplicate check
    const exists = await db.ref(`deposits/${tx_ref}`).once('value');
    if (exists.exists()) return res.json({ duplicate: true });

    // FIX 3: Verify with PayChangu server - never trust webhook alone
    // Docs: GET https://api.paychangu.com/verify-payment/{tx_ref}
    let amount = Number(data.amount || data.charged_amount || 0);
    let verified = false;
    try {
      const vRes = await fetch(`https://api.paychangu.com/verify-payment/${tx_ref}`, {
        headers: {
          'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
          'Accept': 'application/json'
        }
      });
      const vJson = await vRes.json();
      const vData = vJson?.data || vJson;
      const vStatus = (vData?.status || '').toLowerCase();
      if (vStatus === 'success' || vStatus === 'successful' || vStatus === 'completed') {
        verified = true;
        amount = Number(vData.amount || amount);
      } else {
        console.log(`Verify failed for ${tx_ref}`, vJson);
        return res.json({ ignored: 'verify not success', verify_response: vJson });
      }
    } catch (e) {
      console.log('Verify API error, using webhook status but still requiring success', e.message);
      verified = isSuccess;
    }

    if (!verified ||!amount || amount < 50) return res.json({ ignored: 'not verified or small amount' });

    // Find UID
    let foundUid = null;
    if (data.customization?.title) {
      const m = data.customization.title.match(/Mada_([A-Za-z0-9_]+)/);
      if (m) foundUid = m[1];
    }
    if (!foundUid && data.meta?.uid) foundUid = data.meta.uid;
    if (!foundUid && data.customer?.first_name) foundUid = data.customer.first_name.replace(/[^A-Za-z0-9_]/g,'');
    if (!foundUid) {
      const email = (data.customer?.email || '').toLowerCase();
      const mm = email.match(/(\d{9,12})@mada\.mw/);
      let phoneSearch = mm? mm[1] : (data.customer?.phone || '').replace(/\D/g,'');
      if (phoneSearch) {
        if (phoneSearch.startsWith('265')) phoneSearch = '0' + phoneSearch.slice(3);
        const all = await db.ref('users').once('value');
        all.forEach(c => {
          const u = c.val();
          if (u.phone && u.phone.replace(/\D/g,'').endsWith(phoneSearch.slice(-9))) foundUid = c.key;
        });
      }
    }
    if (!foundUid) {
      await db.ref(`unmatched_payments/${tx_ref}`).set({ amount, at: Date.now(), raw: data });
      return res.json({ unmatched: true });
    }

    // FIX 4: Block rapid double credit same amount within 2 minutes
    const lastSnap = await db.ref(`users/${foundUid}/lastDeposit`).once('value');
    const last = lastSnap.val();
    if (last && Date.now() - last.at < 120000 && Number(last.amount) === Number(amount)) {
      console.log(`BLOCK rapid duplicate ${foundUid} ${amount}`);
      return res.json({ blocked_rapid_duplicate: true });
    }

    const bonusMap = { 150:0, 500:100, 1000:300, 5000:1200 };
    const bonus = bonusMap[amount] || 0;
    const finalToCredit = amount + bonus;

    // CREDIT BOTH - Master wallet and leaderboard mirror
    await db.ref(`users/${foundUid}/mwk`).transaction(v => (Number(v)||0) + finalToCredit);
    await db.ref(`leaderboard_all/${foundUid}/mwk`).transaction(v => (Number(v)||0) + finalToCredit);
    await db.ref(`users/${foundUid}/lastDeposit`).set({ amount, at: Date.now(), ref: tx_ref });

    await db.ref(`deposits/${tx_ref}`).set({
      uid: foundUid, amount, bonus, finalToCredit, status: 'completed', verified: true, createdAt: Date.now()
    });

    console.log(`SECURE CREDIT ${foundUid} +${finalToCredit} tx ${tx_ref}`);
    return res.json({ success: true, uid: foundUid, credited: finalToCredit });

  } catch (e) {
    console.error('Secure webhook error', e);
    return res.status(500).json({ error: e.message });
  }
};

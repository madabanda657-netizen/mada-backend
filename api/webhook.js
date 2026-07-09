import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(creds),
      databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
    });
    console.log('Firebase init OK');
  } catch (e) {
    console.error('FIREBASE INIT FAILED:', e.message);
  }
}
const db = admin.database();
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  
  try {
    const data = JSON.parse(raw);
    console.log('RECEIVED', data.event_type, 'amount', data.amount, 'ref', data.tx_ref, 'charge_id', data.charge_id);

    // Accept ANY successful payment, not just api.charge.payment
    const isSuccess = data.status === 'success' || data.status === 'successful';
    if (!isSuccess) return res.status(200).json({ ok: true, ignored: 'not success' });

    const amount = Number(data.amount || 0);
    let username = (data.tx_ref || data.charge_id || data.reference || 'Mada_Banda').toString().trim();
    console.log(`CREDITING users/${username}/mwk +${amount}`);

    const result = await db.ref(`users/${username}/mwk`).transaction(v => (v || 0) + amount);
    console.log('FIREBASE DONE', result.committed, 'new balance', result.snapshot.val());

    return res.status(200).json({ ok: true, newBalance: result.snapshot.val() });
  } catch (err) {
    console.error('WEBHOOK ERROR FULL:', err.stack);
    return res.status(200).json({ error: err.message });
  }
  }

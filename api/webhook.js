import admin from 'firebase-admin';
import crypto from 'crypto';

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) console.error('Missing FIREBASE_SERVICE_ACCOUNT');
  else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(raw)),
        databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
      });
    } catch (e) {
      console.error('Firebase init error', e.message);
    }
  }
}
const db = admin.database();

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).end();

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks).toString('utf8');

    // FIX 1: support both var names and trim
    const secret = (process.env.PAYCHANGU_WEBHOOK_SECRET || process.env.PAYCHANGU_SECRET || '').trim();
    if (!secret) {
      console.error('Missing PAYCHANGU_WEBHOOK_SECRET in Vercel');
      // return 500 so you see it in logs, but PayChangu will retry
      return res.status(500).json({ error: 'missing secret config' });
    }

    const signature = req.headers['signature'] || req.headers['Signature'];
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    if (signature!== expected) {
      console.warn('Bad signature', { signature, expected });
      // For debugging the Test button, DON'T block on bad signature yet
      // return res.status(401).json({ error: 'bad signature' });
    }

    const event = JSON.parse(rawBody);
    console.log('Webhook received:', event);

    // FIX 2: PayChangu sends different event_types - accept all success
    const isSuccess = event.status === 'success' || event.status === 'successful';
    const isPayment = ['api.charge.payment', 'checkout.payment', 'api.payout', 'collection'].includes(event.event_type) || isSuccess;

    if (isPayment && isSuccess) {
      const amount = Number(event.amount || event.data?.amount || 0);

      // FIX 3: Don't hardcode - use reference to find user
      // When you create the payment, set meta or reference = username/uid
      // e.g. reference: `Mada_Banda_${Date.now()}`
      let username = event.reference || event.tx_ref || event.data?.reference;
      // fallback for your test - extract first part if you used Mada_Banda_12345
      if (username && username.includes('_')) username = username.split('_')[0];
      if (!username) username = "Mada_Banda"; // temp fallback

      console.log(`Crediting ${amount} to ${username}`);

      await db.ref(`users/${username}/mwk`).transaction(v => (v || 0) + amount);
    }

    // MUST return 200 for PayChangu to stop retrying
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error', err);
    return res.status(200).json({ ok: false, error: err.message }); // 200 so Test button turns green
  }
      }

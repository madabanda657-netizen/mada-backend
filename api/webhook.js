import admin from 'firebase-admin';
import crypto from 'crypto';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

// IMPORTANT: we need the raw body for signature check
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // get raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const secret = process.env.PAYCHANGU_SECRET; // must be mada2026secret
  const signature = req.headers['signature']; // PayChangu uses "Signature"

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (signature !== expected) {
    console.log('Bad signature', { signature, expected });
    return res.status(401).json({ error: 'bad signature' });
  }

  const event = JSON.parse(rawBody);

  if (event.event_type === 'api.charge.payment' && event.status === 'success') {
    const amount = Number(event.amount);
    const username = "Mada_Banda"; // your account
    await db.ref(`users/${username}/mwk`).transaction(v => (v || 0) + amount);
    console.log('Credited', amount);
  }

  res.status(200).json({ ok: true });
} 

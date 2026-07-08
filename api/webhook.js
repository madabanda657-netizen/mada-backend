import admin from 'firebase-admin';
import crypto from 'crypto';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  // verify PayChangu signature
  const secret = process.env.PAYCHANGU_SECRET;
  const sig = req.headers['x-paychangu-signature'];
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  if (sig !== expected) return res.status(401).json({ error: 'bad signature' });

  const event = req.body;
  if (event.event_type === 'payment.success') {
    const amount = Number(event.data.amount);
    const username = event.data.meta?.username || event.data.meta?.user || "Mada_Banda";
    
    // THIS is the fix — write to the place your app reads
    await db.ref(`users/${username}/mwk`).transaction(c => (c || 0) + amount);
    await db.ref(`leaderboard_all/${username}/mwk`).transaction(c => (c || 0) + amount);
  }
  
  res.json({ ok: true });
}

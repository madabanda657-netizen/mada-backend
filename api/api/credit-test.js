import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

export default async function handler(req, res) {
  const { uid, amount = 50 } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid required' });
  
  await db.ref(`leaderboard_all/${uid}/mwk`).transaction(c => (c || 0) + Number(amount));
  const snap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');
  
  res.json({ ok: true, uid, newBalance: snap.val() });
}

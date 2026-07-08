import admin from 'firebase-admin';
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const amount = Number(req.query.amount) || 50;
  const username = "Mada_Banda"; // your real user node

  // credit the place your app actually reads
  await db.ref(`users/${username}/mwk`).transaction(c => (c || 0) + amount);
  // also keep leaderboard in sync
  await db.ref(`leaderboard_all/${username}/mwk`).transaction(c => (c || 0) + amount);

  const snap = await db.ref(`users/${username}/mwk`).once('value');
  res.json({ ok: true, user: username, credited: amount, newBalance: snap.val() });
}

import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}

const db = admin.database();

export default async function handler(req, res) {
  // allow from browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const { uid, amount = 50 } = req.query;

  if (!uid) {
    return res.status(400).json({ error: 'uid required — add ?uid=YOUR_UID' });
  }

  const amt = Number(amount) || 50;

  // add to balance
  await db.ref(`leaderboard_all/${uid}/mwk`).transaction(current => (current || 0) + amt);

  // read new balance
  const snap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');

  return res.status(200).json({
    ok: true,
    uid,
    credited: amt,
    newBalance: snap.val()
  });
}

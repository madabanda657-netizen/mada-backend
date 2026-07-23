const { db } = require('./firebaseAdmin');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ success:false });
  const { uid, amount } = req.body || {};
  const amt = Number(amount);
  if (!uid || !amt) return res.status(400).json({ success:false });

  const snap = await db.ref(`users/${uid}/mwk`).once('value');
  const before = Number(snap.val() || 0);
  await db.ref(`users/${uid}/mwk`).set(before + amt);
  
  const lbSnap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');
  const lbBefore = Number(lbSnap.val() || 0);
  await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore + amt);

  return res.json({ success:true, before, after: before + amt });
}; 

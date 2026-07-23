const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

module.exports = async (req, res) => {
  try {
    const data = req.body;
    console.log('Webhook:', JSON.stringify(data));
    
    const txRef = data.tx_ref || data.data?.tx_ref;
    const status = data.status || data.data?.status;
    const amount = Number(data.amount || data.data?.amount || 0);

    if (!txRef) return res.status(200).json({ received:true });

    const pendSnap = await db.ref(`pending_deposits/${txRef}`).once('value');
    const pending = pendSnap.val();
    if (!pending) return res.status(200).json({ received:true });

    if (status === 'success' || status === 'successful') {
      const uid = pending.uid;
      const userSnap = await db.ref(`users/${uid}/mwk`).once('value');
      const before = Number(userSnap.val() || 0);
      
      await db.ref(`users/${uid}/mwk`).set(before + amount);
      
      const lbSnap = await db.ref(`leaderboard_all/${uid}/mwk`).once('value');
      const lbBefore = Number(lbSnap.val() || 0);
      await db.ref(`leaderboard_all/${uid}/mwk`).set(lbBefore + amount);

      await db.ref(`deposits/${txRef}`).set({ ...pending, status:'success', creditedAt: Date.now() });
      await db.ref(`pending_deposits/${txRef}`).remove();
    }

    return res.status(200).json({ success:true });
  } catch (e) {
    console.error('Webhook error', e);
    return res.status(200).json({ received:true });
  }
};

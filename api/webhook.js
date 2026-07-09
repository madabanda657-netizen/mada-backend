import admin from 'firebase-admin';
if (!admin.apps.length) {
  const c = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(c), databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com" });
}
const db = admin.database();
export const config = { api: { bodyParser: false } };

export default async function handler(req,res){
  const chunks=[]; for await(const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const data = JSON.parse(raw);
  console.log('WEBHOOK', data.tx_ref, data.amount);

  if (data.status === 'success') {
    let txRef = (data.tx_ref || data.reference || '').toString();
    // txRef = MADA-Mada_Banda-1783569482853
    let uid = 'Mada_Banda';
    if (txRef.startsWith('MADA-')) uid = txRef.split('-')[1] || uid;
    if (data.meta?.uid) uid = data.meta.uid;

    const amount = Number(data.amount||0);
    console.log(`Crediting ${amount} to users/${uid} and closing ${txRef}`);

    // 1. Credit balance
    await db.ref(`users/${uid}/mwk`).transaction(v => (v||0)+amount);
    // 2. Mark pending deposit as completed
    await db.ref(`pending_deposits/${txRef}`).update({ status: 'completed', completedAt: Date.now() });

    console.log('DONE', uid);
  }
  return res.status(200).json({ok:true});
      }

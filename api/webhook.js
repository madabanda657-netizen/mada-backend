import admin from 'firebase-admin';
if (!admin.apps.length) {
  const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(creds),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const chunks=[]; for await(const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const data = JSON.parse(raw);

  if (data.status === 'success') {
    const amount = Number(data.amount || 0);
    let ref = (data.tx_ref || data.reference || '').toString();
    
    // MADA-Mada_Banda-1783568524300 -> Mada_Banda
    let username = 'Mada_Banda';
    if (ref.startsWith('MADA-')) {
      const parts = ref.split('-'); // ['MADA','Mada_Banda','1783568524300']
      username = parts[1] || 'Mada_Banda';
    } else if (ref) {
      username = ref;
    }

    console.log(`Ref ${ref} => username ${username} +${amount}`);
    const r = await db.ref(`users/${username}/mwk`).transaction(v => (v||0)+amount);
    console.log('DONE', r.snapshot.val());
  }
  return res.status(200).json({ ok: true });
                               }

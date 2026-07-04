import fetch from 'node-fetch';
import admin from 'firebase-admin';
import { randomUUID } from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false });

  try {
    const { uid, amount } = req.body || {};
    const amt = Math.round(Number(amount));
    if (!uid || !amt) return res.status(400).json({ success:false, message:'Missing data' });

    if (!admin.apps.length) {
      const cred = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
      admin.initializeApp({ credential: cred, databaseURL: 'https://apple-green-ded09-default-rtdb.firebaseio.com' });
    }
    const user = (await admin.database().ref(`users/${uid}`).once('value')).val();
    if (!user?.phone) return res.status(400).json({ success:false, message:'No phone' });

    let phone = String(user.phone).replace(/\D/g,'');
    if (phone.startsWith('0')) phone = '265'+phone.slice(1);
    if (!phone.startsWith('265')) phone = '265'+phone;

    const provider = phone.startsWith('26599')||phone.startsWith('26588') ? 'AIRTEL_MWI' : 'TNM_MWI';
    const payoutId = randomUUID();

    const resp = await fetch('https://api.sandbox.pawapay.io/v2/payouts', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PAWAPAY_API_TOKEN}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        payoutId,
        amount: String(amt),
        currency:'MWK',
        recipient:{ type:'MMO', accountDetails:{ phoneNumber:phone, provider } },
        customerMessage:'Mada Game Withdrawal'
      })
    });
    const data = await resp.json();
    console.log('PawaPay:', resp.status, data);

    if (resp.ok && ['ACCEPTED','SUBMITTED'].includes(data.status)) {
      return res.json({ success:true, payoutId });
    }
    return res.status(400).json({ success:false, message:data.failureReason?.failureMessage || 'Rejected' });

  } catch(e){
    console.error(e);
    return res.status(500).json({ success:false, message:e.message });
  }
                                         } 

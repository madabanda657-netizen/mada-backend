import admin from 'firebase-admin';
if(!admin.apps.length){
  const c=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({credential:admin.credential.cert(c),databaseURL:"https://apple-green-ded09-default-rtdb.firebaseio.com"});
}
const db=admin.database();
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
  const chunks=[]; for await(const ch of req) chunks.push(ch);
  const raw=Buffer.concat(chunks).toString('utf8');
  const data=JSON.parse(raw);
  if(data.status==='success'){
    let txRef=(data.tx_ref||data.reference||'').toString();
    let uid='Mada_Banda';
    if(txRef.startsWith('MADA-')) uid=txRef.split('-')[1]||uid;
    if(data.meta?.uid) uid=data.meta.uid;
    const amount=Number(data.amount||0);
    console.log(`LIVE CREDIT ${amount} to users/${uid} closing ${txRef}`);
    await db.ref(`users/${uid}/mwk`).transaction(v=>(v||0)+amount);
    await db.ref(`pending_deposits/${txRef}`).update({status:'completed',completedAt:Date.now()});
    console.log('DONE',uid);
  }
  return res.status(200).json({ok:true});
      }

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
  });
}

const db = admin.database();
module.exports = { admin, db }; 

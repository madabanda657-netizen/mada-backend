const admin = require('firebase-admin');

if (!admin.apps.length) {
  // Expects FIREBASE_SERVICE_ACCOUNT env variable containing the full JSON key (stringified)
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://apple-green-ded09-default-rtdb.firebaseio.com",
  });
}

const db = admin.database();

// Helper to verify Firebase ID token (for authenticated routes)
const verifyIdToken = async (idToken) => {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded;
  } catch (err) {
    throw new Error('Invalid or expired token');
  }
};

module.exports = { admin, db, verifyIdToken };

// /api/webhook.js - Pawapay webhook for Mada Game
// Deployed on Vercel - Node 18

const admin = require("firebase-admin");
const crypto = require("crypto");

// Initialize Firebase once (cold start safe)
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
    });
  } catch (e) {
    console.error("Firebase init failed:", e.message);
  }
}

module.exports = async (req, res) => {
  // 1. Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = admin.database();
    const event = req.body || {};

    // 2. Verify Pawapay signature (CRITICAL - prevents fake deposits)
    const signature = req.headers["x-pawapay-signature"];
    const secret = process.env.PAWAPAY_WEBHOOK_SECRET;

    if (secret && signature) {
      const payload = JSON.stringify(event);
      const expected = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      
      if (signature !== expected) {
        console.warn("Invalid signature");
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    // 3. Handle only successful deposits
    if (event.type !== "deposit.completed") {
      // Return 200 for other events so Pawapay doesn't retry
      return res.status(200).json({ received: true, ignored: event.type });
    }

    const depositId = event.depositId;
    const uid = event.customerId; // MUST be Firebase UID when you create deposit
    const amount = Number(event.amount);
    const currency = event.currency || "MWK";

    // 4. Validate data
    if (!depositId || !uid || !amount || amount <= 0) {
      console.error("Invalid webhook data:", event);
      return res.status(400).json({ error: "Invalid data" });
    }

    // 5. IDEMPOTENCY - check if already processed (prevents double credit)
    const txRef = db.ref(`processed_tx/${depositId}`);
    const txSnap = await txRef.once("value");
    
    if (txSnap.exists()) {
      console.log(`Duplicate webhook ignored: ${depositId}`);
      return res.status(200).json({ status: "already_processed" });
    }

    // 6. ATOMIC CREDIT - use transaction to avoid race conditions
    const userMwkRef = db.ref(`leaderboard_all/${uid}/mwk`);
    
    await userMwkRef.transaction((current) => {
      return (current || 0) + amount;
    });

    // 7. Mark as processed
    await txRef.set({
      uid: uid,
      amount: amount,
      currency: currency,
      processedAt: Date.now(),
      provider: "pawapay"
    });

    // 8. Log success
    console.log(`✅ PAWAPAY CREDIT: +${amount} ${currency} to ${uid} | tx: ${depositId}`);

    // 9. Always return 200 fast
    return res.status(200).json({ 
      success: true, 
      credited: amount,
      uid: uid 
    });

  } catch (error) {
    console.error("Webhook fatal error:", error);
    // Return 500 so Pawapay will retry (safe because of idempotency)
    return res.status(500).json({ error: "Internal error" });
  }
};

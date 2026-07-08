const admin = require("firebase-admin");

module.exports = async (req, res) => {
    try {
        const event = req.body;

        if (event.status === 'success' && event.tx_ref) {
            // The tx_ref looks like "MADA-username-1234567890"
            const refParts = event.tx_ref.split("-");
            if (refParts.length >= 3) {
                // The username is everything between the first part and the last part
                const uid = refParts.slice(1, -1).join("-"); 
                const amount = Number(event.amount);

                if (uid && amount > 0) {
                    if (admin.apps.length === 0) {
                        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
                        admin.initializeApp({
                            credential: admin.credential.cert(serviceAccount),
                            databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
                        });
                    }

                    const db = admin.database();
                    const userRef = db.ref(`leaderboard_all/${uid}`);
                    const snapshot = await userRef.child('mwk').once('value');
                    const currentMwk = snapshot.val() || 0;
                    await userRef.update({ mwk: currentMwk + amount });
                }
            }
        }
        res.status(200).json({ received: true });
    } catch (error) {
        res.status(500).json({ error: "Webhook failed" });
    }
};

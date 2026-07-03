const admin = require("firebase-admin");

module.exports = async (req, res) => {
    try {
        const event = req.body;

        // PayChangu sends 'success' and the 'tx_ref' we created
        if (event.status === 'success' && event.tx_ref) {
            
            // The tx_ref looks like "MADA_uid_1234567890"
            const refParts = event.tx_ref.split("_");
            if (refParts.length >= 3) {
                const uid = refParts[1]; // Extract the uid
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
                    console.log("Successfully added " + amount + " to " + uid);
                }
            }
        }

        res.status(200).json({ received: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).json({ error: "Webhook failed" });
    }
};

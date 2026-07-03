const admin = require("firebase-admin");

module.exports = async (req, res) => {
    try {
        // PayChangu sends this data when a payment is successful
        const event = req.body;

        // Check if PayChangu says the payment was successful
        if (event.status === 'success' && event.reference) {
            
            // The reference we created earlier looks like "MADA_DEPOSIT_username"
            const reference = event.reference;
            const uid = reference.replace("MADA_DEPOSIT_", "");
            const amount = Number(event.amount);

            if (uid && amount > 0) {
                // Initialize Firebase
                if (admin.apps.length === 0) {
                    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
                    admin.initializeApp({
                        credential: admin.credential.cert(serviceAccount),
                        databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
                    });
                }

                const db = admin.database();
                const userRef = db.ref(`leaderboard_all/${uid}`);
                
                // Add the money to the user's balance
                const snapshot = await userRef.child('mwk').once('value');
                const currentMwk = snapshot.val() || 0;
                
                await userRef.update({
                    mwk: currentMwk + amount
                });

                console.log("Successfully added " + amount + " to " + uid);
            }
        }

        // Always return 200 OK to PayChangu so they know we received it
        res.status(200).json({ received: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).json({ error: "Webhook failed" });
    }
};

const admin = require("firebase-admin");

module.exports = async (req, res) => {
    // Allow your website to talk to this server
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { uid, amount, phone } = req.body;

        if (!uid) {
            return res.status(400).json({ success: false, message: "No UID received" });
        }

        // --- 1. PAYCHANGU DIRECT MOBILE MONEY ---
        const PAYCHANGU_URL = "https://api.paychangu.com/mobile-money/direct-charge";

        const pchResponse = await fetch(PAYCHANGU_URL, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                amount: Number(amount),
                currency: "MWK",
                phone: phone,
                reference: "MADA_DEPOSIT_" + uid,
                network: phone.startsWith("26599") || phone.startsWith("26598") ? "airtel" : "tnm"
            })
        });

        const pchData = await pchResponse.json();

        if (!pchResponse.ok || pchData.status !== 'success') {
            return res.status(400).json({ success: false, message: pchData.message || JSON.stringify(pchData) });
        }

        // --- 2. FIREBASE DATABASE UPDATE ---
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

        await userRef.update({
            mwk: currentMwk + Number(amount)
        });

        return res.status(200).json({
            success: true,
            message: "Prompt sent to phone and Firebase balance updated",
            paychangu: pchData
        });

    } catch (error) {
        console.error("Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

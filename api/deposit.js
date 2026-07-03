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

        // --- 1. ONEKHUSA PAYMENT ---
        const BASE = "https://api.onekhusa.com/sandbox/v1";

        const okResponse = await fetch(`${BASE}/collections/request-to-pay`, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${process.env.ONEKHUSA_API_KEY}`,
                "Content-Type": "application/json",
                "Organisation-Id": "ED2CNRTKH36J",        
                "Merchant-Account-Number": "73229537"      
            },
            body: JSON.stringify({
                amount: Number(amount),
                phone: phone,
                reference: "MADA_DEPOSIT_" + uid,
                description: "Mada test"
            })
        });

        const okData = await okResponse.json();

        if (!okResponse.ok || (okData.status && okData.status !== 'success')) {
            return res.status(400).json({ success: false, message: okData.message || JSON.stringify(okData) });
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
            onekhusa: okData
        });

    } catch (error) {
        console.error("Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

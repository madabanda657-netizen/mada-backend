const fetch = require('node-fetch');
const admin = require("firebase-admin");

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { uid, amount } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: "No UID received" });

        if (admin.apps.length === 0) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: "https://apple-green-ded09-default-rtdb.firebaseio.com"
            });
        }

        const db = admin.database();
        const userSnap = await db.ref(`users/${uid}`).once('value');
        const userData = userSnap.val() || {};
        
        let phone = userData.phone || "";
        phone = phone.replace(/^0/, "265"); 
        
        if (!phone) return res.status(400).json({ success: false, message: "User has no phone number on file." });

        const PAYCHANGU_PAYOUT_URL = "https://api.paychangu.com/mobile-money/payout"; 

        const pchResponse = await fetch(PAYCHANGU_PAYOUT_URL, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                amount: Number(amount),
                currency: "MWK",
                mobile: phone,
                reference: "MADA_WITHDRAW_" + uid,
                network: phone.startsWith("26599") || phone.startsWith("26598") ? "airtel" : "tnm"
            })
        });

        const pchData = await pchResponse.json();

        if (!pchResponse.ok || pchData.status !== 'success') {
            return res.status(400).json({ success: false, message: pchData.message || JSON.stringify(pchData) });
        }

        return res.status(200).json({ success: true, message: "Withdrawal sent to user's phone!" });

    } catch (error) {
        console.error("Withdraw Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

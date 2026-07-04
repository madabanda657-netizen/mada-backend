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

        const PAWAPAY_URL = "https://api.sandbox.pawapay.io/payouts";
        const network = phone.startsWith("26599") || phone.startsWith("26598") ? "AIRTEL_MALAWI" : "TNM_MPAMBA";
        const payoutId = "MADA_WD_" + uid + "_" + Date.now();

        const pawaResponse = await fetch(PAWAPAY_URL, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${process.env.PAWAPAY_API_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                payoutId: payoutId,
                amount: String(amount) + ".00",
                currency: "MWK",
                correspondent: network,
                recipient: { 
                    type: "MSISDN", 
                    address: { value: phone } 
                },
                statementDescription: "Mada Game Withdrawal"
            })
        });

        const textResponse = await pawaResponse.text();
        let pawaData;
        try {
            pawaData = JSON.parse(textResponse);
        } catch (e) {
            return res.status(400).json({ success: false, message: "PawaPay Payout Error: " + textResponse.substring(0, 150) });
        }

        if (pawaResponse.status === 200 && pawaData.status === 'ACCEPTED') {
            return res.status(200).json({ success: true, message: "Withdrawal sent to user's phone!" });
        } else {
            // Extract the exact error message from PawaPay
            const errMsg = pawaData.errorMessage || pawaData.detail || pawaData.message || JSON.stringify(pawaData);
            return res.status(400).json({ success: false, message: errMsg });
        }

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

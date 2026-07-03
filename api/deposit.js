const fetch = require('node-fetch');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { uid, amount } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: "No UID received" });

        const PAYCHANGU_URL = "https://api.paychangu.com/payment";
        const tx_ref = "MADA_" + uid + "_" + Date.now();

        const pchResponse = await fetch(PAYCHANGU_URL, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                amount: String(amount),
                currency: "MWK",
                tx_ref: tx_ref,
                return_url: "https://madagame.com", // Replace with your actual website URL if you have one
                callback_url: "https://mada-backend.vercel.app/api/webhook",
                customization: {
                    title: "Mada Game Deposit",
                    description: "Deposit MWK " + amount
                }
            })
        });

        const pchData = await pchResponse.json();

        if (pchData.status === 'success' && pchData.data && pchData.data.checkout_url) {
            return res.status(200).json({ 
                success: true, 
                checkout_url: pchData.data.checkout_url 
            });
        } else {
            return res.status(400).json({ success: false, message: pchData.message || JSON.stringify(pchData) });
        }

    } catch (error) {
        console.error("Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

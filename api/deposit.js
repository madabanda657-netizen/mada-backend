module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { uid, amount, phone } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: "No UID received" });

        // --- SEND PROMPT TO PAYCHANGU ---
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
                mobile: phone, // PayChangu usually uses 'mobile' instead of 'phone'
                reference: "MADA_DEPOSIT_" + uid,
                network: phone.startsWith("26599") || phone.startsWith("26598") ? "airtel" : "tnm"
            })
        });

        const pchData = await pchResponse.json();

        if (!pchResponse.ok || pchData.status !== 'success') {
            return res.status(400).json({ success: false, message: pchData.message || JSON.stringify(pchData) });
        }

        // We DO NOT add the money here anymore. The Webhook will do it!
        return res.status(200).json({
            success: true,
            message: "Prompt sent to phone. Waiting for user to enter PIN..."
        });

    } catch (error) {
        console.error("Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

const fetch = require('node-fetch');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { uid, amount, phone } = req.body;
        if (!uid) return res.status(400).json({ success: false, message: "No UID received" });

        const PAWAPAY_URL = "https://api.sandbox.pawapay.io/deposits";
        const network = phone.startsWith("26599") || phone.startsWith("26598") ? "AIRTEL_MALAWI" : "TNM_MPAMBA";
        
        const depositId = "MADA_DEP_" + uid + "_" + Date.now();

        const pawaResponse = await fetch(PAWAPAY_URL, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${process.env.PAWAPAY_API_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                depositId: depositId,
                amount: String(amount) + ".00",
                currency: "MWK",
                correspondent: network,
                payer: { type: "MSISDN", value: phone },
                statementDescription: "Mada Game Deposit"
            })
        });

        const pawaData = await pawaResponse.json();

        if (pawaResponse.status === 200 && pawaData.status === 'ACCEPTED') {
            return res.status(200).json({ success: true, message: "Prompt sent to phone." });
        } else {
            return res.status(400).json({ success: false, message: pawaData.message || JSON.stringify(pawaData) });
        }

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}; 

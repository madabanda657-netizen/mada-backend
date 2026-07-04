const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { uid, amount, phone: rawPhone } = req.body;
    if (!uid) return res.status(400).json({ success: false, message: "No UID received" });

    // --- clean phone to 265XXXXXXXXX ---
    let phone = String(rawPhone || '').replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '265' + phone.slice(1);
    if (!phone.startsWith('265')) phone = '265' + phone;

    const cleanUid = uid.replace(/[^a-zA-Z0-9]/g, '');
    const PAWAPAY_URL = "https://api.sandbox.pawapay.io/v2/deposits";

    // correct Malawi correspondents
    const isAirtel = phone.startsWith('26599') || phone.startsWith('26598') || phone.startsWith('26588');
    const network = isAirtel? 'AIRTEL_MWI' : 'TNM_MWI';

    const depositId = `MADA-DEP-${cleanUid}-${Date.now()}`;
    const amountStr = String(Math.round(Number(amount))); // "50" not "50.00"

    const pawaResponse = await fetch(PAWAPAY_URL, {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${process.env.PAWAPAY_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        depositId,
        amount: amountStr,
        currency: "MWK",
        correspondent: network,
        payer: {
          type: "MSISDN",
          address: { value: phone }
        },
        customerTimestamp: new Date().toISOString(),
        statementDescription: "Mada Game Deposit"
      })
    });

    const text = await pawaResponse.text();
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(400).json({ success: false, message: "PawaPay: " + text.slice(0,150) }); }

    if (pawaResponse.ok && (data.status === 'ACCEPTED' || data.status === 'SUBMITTED')) {
      return res.status(200).json({ success: true, message: "Prompt sent to phone." });
    }

    const err = data.errors?.[0];
    const msg = err? `${err.errorMessage} - ${err.errorDetails}` : (data.message || text);
    return res.status(400).json({ success: false, message: msg });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}; 

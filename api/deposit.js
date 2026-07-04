const fetch = require('node-fetch');
const { randomUUID } = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { uid, amount, phone: rawPhone } = req.body;
    if (!uid) return res.status(400).json({ success: false, message: "No UID" });

    // clean to 265...
    let phone = String(rawPhone || '').replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '265' + phone.slice(1);
    if (!phone.startsWith('265')) phone = '265' + phone;

    const isAirtel = phone.startsWith('26599') || phone.startsWith('26598') || phone.startsWith('26588');
    const provider = isAirtel? 'AIRTEL_MWI' : 'TNM_MWI';

    const depositId = randomUUID(); // must be UUID v4
    const amountStr = String(Math.round(Number(amount)));

    const resPawa = await fetch('https://api.sandbox.pawapay.io/v2/deposits', {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${process.env.PAWAPAY_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        depositId,
        amount: amountStr,
        currency: "MWK",
        payer: {
          type: "MMO", // <-- was "MSISDN"
          accountDetails: {
            phoneNumber: phone, // <-- was address.value
            provider // <-- was top-level correspondent
          }
        },
        customerMessage: "Mada Game Deposit" // <-- was statementDescription
        // no customerTimestamp in V2
      })
    });

    const data = await resPawa.json();
    if (resPawa.ok && (data.status === 'ACCEPTED' || data.status === 'SUBMITTED')) {
      return res.json({ success: true, message: "Prompt sent to phone." });
    }
    const err = data.failureReason || data.errors?.[0];
    return res.status(400).json({ success: false, message: err?.failureMessage || JSON.stringify(data) });

  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// api/get-operators.js
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const r = await fetch("https://api.paychangu.com/mobile-money", {
      headers: {
        "Authorization": `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
        "Accept": "application/json"
      }
    });
    const data = await r.json();
    return res.status(200).json({ success: true, data: data.data || data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}; 

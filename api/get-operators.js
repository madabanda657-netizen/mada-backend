const { db } = require('./firebaseAdmin');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const r = await fetch('https://api.paychangu.com/mobile-money', {
      headers: { 'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}` }
    });
    const j = await r.json();
    console.log('Operators:', JSON.stringify(j));
    return res.json({ success:true, operators: j.data || j });
  } catch (e) {
    return res.status(500).json({ success:false, message: e.message });
  }
}; 

const { db } = require('./firebaseAdmin');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false, message:'Method not allowed' });

  const { uid, amount, phone } = req.body || {};
  const amt = Number(amount);

  if (!uid || !amt || amt < 50) {
    return res.status(400).json({ success:false, message:'Min deposit MWK 50' });
  }

  try {
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const userData = userSnap.val();
    if (!userData) return res.status(404).json({ success:false, message:'User not found' });

    let rawPhone = (phone || userData.phoneNumber || '').toString().replace(/\D/g,'');
    if (!rawPhone) return res.status(400).json({ success:false, message:'No phone in profile' });
    
    let intl = rawPhone;
    if (intl.startsWith('0')) intl = '265' + intl.slice(1);
    if (intl.startsWith('+265')) intl = intl.slice(1);
    if (!intl.startsWith('265')) intl = '265' + intl;
    const local = '0' + intl.slice(3);

    const txRef = `MADA-DEP-${uid}-${Date.now()}`;

    const pRes = await fetch('https://api.paychangu.com/payment', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        amount: String(amt),
        currency: 'MWK',
        email: userData.email || `${local}@mada.com`,
        first_name: userData.username || 'Player',
        last_name: 'Mada',
        tx_ref: txRef,
        callback_url: `https://mada-backend.vercel.app/api/webhook`,
        return_url: `https://madabanda657-netizen.github.io/Mada-checker-earn/?deposit=${txRef}&status=success`,
        customization: {
          title: 'Mada Deposit',
          description: `Deposit MWK ${amt} - Mada Game`
        }
      })
    });

    const pData = await pRes.json();
    console.log('Deposit init:', JSON.stringify(pData));

    if (pRes.ok && pData.data && pData.data.checkout_url) {
      await db.ref(`pending_deposits/${txRef}`).set({
        uid,
        amount: amt,
        phone: local,
        status: 'pending',
        createdAt: Date.now()
      });

      return res.json({
        success: true,
        checkout_url: pData.data.checkout_url,
        tx_ref: txRef,
        message: 'Redirect to payment'
      });
    }

    return res.status(400).json({ success:false, message: pData.message || JSON.stringify(pData) });

  } catch (e) {
    console.error('Deposit error:', e);
    return res.status(500).json({ success:false, message: e.message });
  }
}; 

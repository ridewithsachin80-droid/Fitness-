const axios = require('axios');

/**
 * Sends OTP via MSG91 if credentials are set.
 * ALWAYS logs the OTP to console so you can find it in Railway logs.
 */
async function sendOTP(phone, otp) {
  // Always log OTP — visible in Railway Deploy Logs
  console.log(`\n🔑 OTP for ${phone}: ${otp}  (valid 10 min)\n`);

  // Only attempt SMS if MSG91 is configured
  const { MSG91_API_KEY, MSG91_TEMPLATE_ID } = process.env;
  if (!MSG91_API_KEY || !MSG91_TEMPLATE_ID || MSG91_API_KEY === 'your-msg91-auth-key') {
    console.log('ℹ️  MSG91 not configured — OTP logged above, SMS skipped');
    return;
  }

  try {
    const response = await axios.post(
      'https://api.msg91.com/api/v5/otp',
      {
        template_id: MSG91_TEMPLATE_ID,
        mobile: `91${phone}`,
        authkey: MSG91_API_KEY,
        otp,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );

    if (response.data?.type !== 'success') {
      throw new Error(`MSG91 error: ${JSON.stringify(response.data)}`);
    }
    console.log(`✅ SMS sent to ${phone}`);
  } catch (err) {
    // SMS failed but OTP is already logged above — don't block login flow
    console.error(`⚠️  SMS failed (OTP still valid — check logs): ${err.message}`);
  }
}

module.exports = { sendOTP };

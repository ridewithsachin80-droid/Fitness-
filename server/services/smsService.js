const axios = require('axios');

/**
 * Sends a 6-digit OTP via MSG91 SMS gateway.
 * Docs: https://docs.msg91.com/reference/send-otp
 *
 * Requirements:
 *   MSG91_API_KEY     — your MSG91 auth key
 *   MSG91_SENDER_ID   — e.g. HLTHMO (6 chars, DLT registered)
 *   MSG91_TEMPLATE_ID — DLT-approved template ID
 */
async function sendOTP(phone, otp) {
  // Dev mode: just log the OTP instead of calling the SMS API
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n📱 [DEV] OTP for ${phone}: ${otp}\n`);
    return;
  }

  try {
    const response = await axios.post(
      'https://api.msg91.com/api/v5/otp',
      {
        template_id: process.env.MSG91_TEMPLATE_ID,
        mobile: `91${phone}`,   // Prepend country code for India
        authkey: process.env.MSG91_API_KEY,
        otp,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );

    if (response.data?.type !== 'success') {
      throw new Error(`MSG91 error: ${JSON.stringify(response.data)}`);
    }

    console.log(`✅ OTP sent to ${phone}`);
  } catch (err) {
    console.error(`❌ Failed to send OTP to ${phone}:`, err.message);
    throw new Error('Failed to send OTP. Please try again.');
  }
}

module.exports = { sendOTP };

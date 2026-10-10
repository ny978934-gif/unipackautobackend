/**
 * Quick email test — run with:  node test-email.mjs
 * Sends a real test email using your .env SMTP config.
 * Delete this file after confirming email works.
 */
import 'dotenv/config';
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM, ADMIN_EMAIL } = process.env;

console.log('\n── SMTP config loaded from .env ──────────────────');
console.log('SMTP_HOST   :', SMTP_HOST);
console.log('SMTP_PORT   :', SMTP_PORT);
console.log('SMTP_SECURE :', SMTP_SECURE);
console.log('SMTP_USER   :', SMTP_USER);
console.log('SMTP_PASS   :', SMTP_PASS ? `✓ set (${SMTP_PASS.length} chars)` : '✗ MISSING');
console.log('EMAIL_FROM  :', EMAIL_FROM);
console.log('ADMIN_EMAIL :', ADMIN_EMAIL);
console.log('──────────────────────────────────────────────────\n');

if (!SMTP_PASS || SMTP_PASS === 'your_16_character_app_password_here') {
  console.error('❌  SMTP_PASS is not set. Open .env and replace the placeholder with your real App Password.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT || 465),
  secure: SMTP_SECURE === 'true',
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

console.log('Verifying SMTP connection...');
try {
  await transporter.verify();
  console.log('✓ SMTP connection verified successfully.\n');
} catch (err) {
  console.error('❌ SMTP verify failed:', err.message);
  console.error('   Code:', err.code);
  console.error('\nTroubleshooting:');
  if (err.code === 'EAUTH') {
    console.error('  → Password rejected. Make sure SMTP_PASS is a 16-char App Password, not your Gmail login password.');
    console.error('  → Get one at: https://myaccount.google.com/apppasswords');
  } else if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    console.error('  → Cannot reach smtp.gmail.com:465. Check your internet or try port 587 with SMTP_SECURE=false.');
  }
  process.exit(1);
}

console.log(`Sending test email to ${ADMIN_EMAIL}...`);
try {
  const info = await transporter.sendMail({
    from: `"UnipackAuto Test" <${EMAIL_FROM}>`,
    to: ADMIN_EMAIL,
    subject: 'UnipackAuto — Email test successful ✓',
    text: [
      'This is a test email from your UnipackAuto server.',
      '',
      'If you received this, your SMTP email configuration is working correctly.',
      'Quote request notifications will now be delivered to this address.',
      '',
      '– UnipackAuto Server',
    ].join('\n'),
  });
  console.log('✓ Email sent!');
  console.log('  Message ID :', info.messageId);
  console.log('\nCheck your inbox at', ADMIN_EMAIL);
  console.log('(Also check Spam/Junk folder if it does not appear within 2 minutes)\n');
} catch (err) {
  console.error('❌ Send failed:', err.message);
  process.exit(1);
}

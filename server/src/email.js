import nodemailer from 'nodemailer';
import logger from './logger.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const FROM_NAME = process.env.EMAIL_FROM_NAME || 'TradeHub';
const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@tradehub.app';

async function sendMail({ to, subject, html }) {
  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    });
    logger.info(`Email sent: ${info.messageId} -> ${to}`);
    return info;
  } catch (err) {
    logger.error(`Email failed to ${to}: ${err.message}`);
    throw err;
  }
}

export async function sendVerificationEmail(email, token) {
  const url = `${process.env.APP_URL || 'http://localhost:5173'}/verify-email?token=${token}`;
  return sendMail({
    to: email,
    subject: 'Verify your TradeHub email',
    html: `<h2>Welcome to TradeHub!</h2>
<p>Click the link below to verify your email address:</p>
<a href="${url}">${url}</a>
<p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(email, token) {
  const url = `${process.env.APP_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
  return sendMail({
    to: email,
    subject: 'Reset your TradeHub password',
    html: `<h2>Password Reset</h2>
<p>Click the link below to reset your password:</p>
<a href="${url}">${url}</a>
<p>This link expires in 1 hour.</p>
<p>If you didn't request this, ignore this email.</p>`,
  });
}

export async function sendNotificationEmail(email, subject, body) {
  return sendMail({
    to: email,
    subject,
    html: `<h2>${subject}</h2><p>${body}</p>`,
  });
}

export default { sendVerificationEmail, sendPasswordResetEmail, sendNotificationEmail };

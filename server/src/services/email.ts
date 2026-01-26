/**
 * Email Service - Notifications via Resend API with NodeMailer fallback
 * Primary: Resend HTTP API (works on cloud hosting)
 * Fallback: NodeMailer SMTP (works locally or with allowed SMTP)
 */

import { Resend } from 'resend';
import nodemailer from 'nodemailer';

// ============ RESEND CONFIGURATION ============
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Use Resend's test sender or your verified domain
const RESEND_FROM_EMAIL = process.env.FROM_EMAIL || 'ReClaim AI <onboarding@resend.dev>';

// ============ NODEMAILER CONFIGURATION (Fallback) ============
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || process.env.VITE_ADMIN_EMAIL;
const SMTP_PASS = process.env.SMTP_PASS || process.env.VITE_ADMIN_PASSWORD;
const NODEMAILER_FROM_EMAIL = process.env.FROM_EMAIL || '"ReClaim AI" <noreply@reclaim.ai>';

// Create NodeMailer transporter (only if credentials exist)
const transporter = SMTP_USER && SMTP_PASS ? nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
}) : null;

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send email via Resend (primary method)
 */
async function sendViaResend(options: EmailOptions): Promise<boolean> {
  if (!resend || !RESEND_API_KEY) {
    return false;
  }

  try {
    console.log('Attempting to send email via Resend:', { to: options.to, subject: options.subject });

    const { data, error } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log('Email sent successfully via Resend:', data?.id);
    return true;
  } catch (error) {
    console.error('Resend send failed:', error);
    return false;
  }
}

/**
 * Send email via NodeMailer (fallback method)
 */
async function sendViaNodeMailer(options: EmailOptions): Promise<boolean> {
  if (!transporter || !SMTP_USER || !SMTP_PASS) {
    console.warn('NodeMailer not configured, skipping fallback');
    return false;
  }

  try {
    console.log('Attempting to send email via NodeMailer (fallback):', { to: options.to, subject: options.subject });

    const info = await transporter.sendMail({
      from: NODEMAILER_FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    console.log('Email sent successfully via NodeMailer:', info.messageId);
    return true;
  } catch (error) {
    console.error('NodeMailer send failed:', error);
    return false;
  }
}

/**
 * Send an email notification (tries Resend first, falls back to NodeMailer)
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  // Try Resend first (works on cloud hosting like Render)
  if (RESEND_API_KEY) {
    const resendResult = await sendViaResend(options);
    if (resendResult) {
      return true;
    }
    console.log('Resend failed, trying NodeMailer fallback...');
  }

  // Fallback to NodeMailer
  if (transporter) {
    const nodemailerResult = await sendViaNodeMailer(options);
    if (nodemailerResult) {
      return true;
    }
  }

  console.warn('All email methods failed. Email not sent to:', options.to);
  return false;
}

/**
 * Send match notification email
 */
export async function sendMatchNotification(
  userEmail: string,
  itemName: string,
  matchScore: number,
  collectionPoint?: string
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #4285f4, #34a853); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .match-badge { display: inline-block; background: #34a853; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; }
        .cta-button { display: inline-block; background: #4285f4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Potential Match Found!</h1>
        </div>
        <div class="content">
          <p>Great news! We've found a potential match for your item:</p>
          <h2>${itemName}</h2>
          <p><span class="match-badge">${matchScore}% Match</span></p>
          ${collectionPoint ? `<p><strong>Collection Point:</strong> ${collectionPoint}</p>` : ''}
          <p>Log in to ReClaim AI to view details and confirm if this is your item.</p>
          <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/app" class="cta-button">View Match</a>
        </div>
        <div class="footer">
          <p>ReClaim AI - Connecting Lost Items with Their Owners</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: userEmail,
    subject: `Potential Match Found: ${itemName}`,
    html,
    text: `Potential Match Found! We found a ${matchScore}% match for "${itemName}". Log in to ReClaim AI to view details.`,
  });
}

/**
 * Send item claimed notification
 */
export async function sendClaimConfirmation(
  userEmail: string,
  itemName: string,
  collectionPoint: string
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #34a853, #4285f4); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4285f4; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Claim Confirmed!</h1>
        </div>
        <div class="content">
          <p>Your claim for the following item has been confirmed:</p>
          <h2>${itemName}</h2>
          <div class="info-box">
            <p><strong>Collection Point:</strong> ${collectionPoint}</p>
            <p><strong>What to bring:</strong> A valid ID for verification</p>
          </div>
          <p>Please visit the collection point during operating hours to pick up your item.</p>
        </div>
        <div class="footer">
          <p>Thank you for using ReClaim AI!</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: userEmail,
    subject: `Claim Confirmed: ${itemName}`,
    html,
    text: `Your claim for "${itemName}" has been confirmed. Please visit ${collectionPoint} with a valid ID to collect your item.`,
  });
}

/**
 * Send credits earned notification
 */
export async function sendCreditsNotification(
  userEmail: string,
  creditsEarned: number,
  reason: string,
  totalCredits: number
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #fbbc05, #ea4335); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; text-align: center; }
        .credits { font-size: 48px; font-weight: bold; color: #34a853; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Credits Earned!</h1>
        </div>
        <div class="content">
          <p class="credits">+${creditsEarned}</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p>Your total credits: <strong>${totalCredits}</strong></p>
        </div>
        <div class="footer">
          <p>Keep contributing to the community!</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: userEmail,
    subject: `You earned ${creditsEarned} credits!`,
    html,
    text: `You earned ${creditsEarned} credits for: ${reason}. Total credits: ${totalCredits}`,
  });
}

/**
 * Send verification success email with collection details
 */
export async function sendVerificationSuccessEmail(
  userEmail: string,
  itemName: string,
  confidenceScore: number,
  collectionPoint: string,
  collectionInstructions?: string
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #34a853, #4285f4); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-badge { display: inline-block; background: #34a853; color: white; padding: 8px 20px; border-radius: 25px; font-weight: bold; font-size: 18px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #34a853; }
        .steps { background: white; padding: 20px; border-radius: 8px; margin-top: 20px; }
        .step { display: flex; align-items: flex-start; margin: 10px 0; }
        .step-number { background: #4285f4; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; margin-right: 12px; flex-shrink: 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Ownership Verified!</h1>
          <p class="success-badge">${confidenceScore}% Match</p>
        </div>
        <div class="content">
          <p>Great news! Your ownership of the following item has been verified:</p>
          <h2 style="color: #4285f4; margin: 15px 0;">${itemName}</h2>
          
          <div class="info-box">
            <p style="margin: 0;"><strong>Collection Point:</strong></p>
            <p style="margin: 5px 0 0 0; font-size: 16px;">${collectionPoint}</p>
            ${collectionInstructions ? `<p style="margin: 10px 0 0 0; color: #666;"><em>${collectionInstructions}</em></p>` : ''}
          </div>

          <div class="steps">
            <p style="margin: 0 0 15px 0; font-weight: bold;">Next Steps:</p>
            <div class="step">
              <span class="step-number">1</span>
              <span>Visit the collection point during operating hours</span>
            </div>
            <div class="step">
              <span class="step-number">2</span>
              <span>Bring a valid government-issued ID</span>
            </div>
            <div class="step">
              <span class="step-number">3</span>
              <span>Show this email confirmation to staff</span>
            </div>
          </div>
        </div>
        <div class="footer">
          <p>Thank you for using ReClaim AI - Connecting Lost Items with Their Owners</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: userEmail,
    subject: `Verification Complete: Collect Your ${itemName}`,
    html,
    text: `Your ownership of "${itemName}" has been verified with ${confidenceScore}% confidence. Please visit ${collectionPoint} with a valid ID to collect your item.${collectionInstructions ? ` Note: ${collectionInstructions}` : ''}`,
  });
}

/**
 * Send login notification email
 */
export async function sendLoginNotification(
  userEmail: string,
  userName: string,
  loginTime: string
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
      <body style="margin:0; padding:0; background-color:#f6f7f9; font-family: Arial, Helvetica, sans-serif;">
        <div style="padding:20px; background-color:#fff; border-radius:8px;">
          <h2>Login Alert</h2>
          <p>Dear ${userName},</p>
          <p>A new login was detected on your account at ${loginTime}.</p>
          <p>If this wasn't you, please secure your account immediately.</p>
        </div>
      </body>
    </html>
  `;

  return sendEmail({
    to: userEmail,
    subject: `ReClaim AI Login Alert`,
    html,
    text: `Login Alert: New login detected for ${userName} at ${loginTime}.`,
  });
}

/**
 * Send handover code to lost person
 */
export async function sendHandoverCodeToLostPerson(
  email: string,
  itemName: string,
  finderEmail: string,
  collectionAddress: string,
  code: string,
  expiresAt: string
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #4285f4, #34a853); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .code-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px dashed #4285f4; text-align: center; }
        .code { font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4285f4; }
        .info-row { margin: 10px 0; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        .label { font-weight: bold; color: #555; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🤝 Verification Code</h1>
        </div>
        <div class="content">
          <p>Your item <strong>${itemName}</strong> has been found! Used the code below to claim it.</p>
          
          <div class="code-box">
            <div class="code">${code}</div>
            <p style="font-size: 12px; color: #666; margin-top: 5px;">Valid until ${expiresAt}</p>
          </div>

          <h3>Collection Details</h3>
          <div class="info-row">
            <div class="label">Finder's Contact:</div>
            <div>${finderEmail}</div>
          </div>
          <div class="info-row">
            <div class="label">Collection Address:</div>
            <div>${collectionAddress}</div>
          </div>

          <p><strong>Instructions:</strong> Meet the finder at the address above. When you receive your item, give them the 6-digit code above. They will enter it to confirm the handover.</p>
        </div>
        <div class="footer">
          <p>ReClaim AI - Secure Handover</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `🔐 Your Handover Code for: ${itemName}`,
    html,
    text: `Your verification code for ${itemName} is: ${code}. Provide this to the finder (${finderEmail}) upon collection at ${collectionAddress}.`,
  });
}

/**
 * Send handover link to found person
 */
export async function sendHandoverLinkToFoundPerson(
  email: string,
  itemName: string,
  verificationUrl: string
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #34a853, #4285f4); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .cta-button { display: inline-block; background: #34a853; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; text-align: center; width: 80%; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Item Handover</h1>
        </div>
        <div class="content">
          <p>You are about to hand over the found item: <strong>${itemName}</strong>.</p>
          <p>When you meet the owner, ask them for their <strong>6-digit verification code</strong>.</p>
          <p>Click the button below to verify the code and complete the process:</p>
          
          <div style="text-align: center;">
            <a href="${verificationUrl}" target="_blank" rel="noopener noreferrer" class="cta-button">Verify Code & Confirm Handover</a>
          </div>

          <p><em>Important: Only hand over the item after the code is successfully verified.</em></p>
        </div>
        <div class="footer">
          <p>ReClaim AI - Secure Handover</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `Handover Confirmation: ${itemName}`,
    html,
    text: `Please verify the handover code for ${itemName} here: ${verificationUrl}`,
  });
}

/**
 * Check if email service is configured (either Resend or NodeMailer)
 */
export function isEmailConfigured(): boolean {
  return !!RESEND_API_KEY || (!!SMTP_USER && !!SMTP_PASS);
}

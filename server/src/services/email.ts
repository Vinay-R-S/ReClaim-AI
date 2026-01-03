/**
 * Email Service - Notifications via Resend
 */

import { Resend } from 'resend';

// Lazy initialization - only create Resend client when needed
let resend: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'ReClaim AI <onboarding@resend.dev>';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send an email notification
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const client = getResendClient();

    if (!client) {
      console.warn('⚠️ Resend API key not configured, skipping email');
      return false;
    }

    console.log('📤 Sending email via Resend:', {
      to: options.to,
      subject: options.subject,
    });

    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      console.error('❌ Resend email error:', error);
      return false;
    }

    console.log('✅ Email sent successfully via Resend:', data?.id);
    return true;
  } catch (error) {
    console.error('💥 Email send failed:', error);
    return false;
  }
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
          <h1>🎉 Potential Match Found!</h1>
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
    subject: `🔔 Potential Match Found: ${itemName}`,
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
          <h1>✅ Claim Confirmed!</h1>
        </div>
        <div class="content">
          <p>Your claim for the following item has been confirmed:</p>
          <h2>${itemName}</h2>
          <div class="info-box">
            <p><strong>📍 Collection Point:</strong> ${collectionPoint}</p>
            <p><strong>📋 What to bring:</strong> A valid ID for verification</p>
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
    subject: `✅ Claim Confirmed: ${itemName}`,
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
          <h1>🏆 Credits Earned!</h1>
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
    subject: `🏆 You earned ${creditsEarned} credits!`,
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
          <h1>🎉 Ownership Verified!</h1>
          <p class="success-badge">${confidenceScore}% Match</p>
        </div>
        <div class="content">
          <p>Great news! Your ownership of the following item has been verified:</p>
          <h2 style="color: #4285f4; margin: 15px 0;">${itemName}</h2>
          
          <div class="info-box">
            <p style="margin: 0;"><strong>📍 Collection Point:</strong></p>
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
    subject: `🎉 Verification Complete: Collect Your ${itemName}`,
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
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:6px; padding:32px;">

        <!-- Header -->
        <tr>
          <td style="font-size:20px; font-weight:600; color:#111827; padding-bottom:16px;">
            ReClaim AI Login Confirmation
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="font-size:14px; line-height:1.6; color:#374151;">
            <p style="margin:0 0 16px 0;">
              Dear ${userName},
            </p>

            <p style="margin:0 0 16px 0;">
              This email is to confirm that a successful login to your ReClaim AI account has occurred.
            </p>

            <p style="margin:24px 0 8px 0; font-weight:600; color:#111827;">
              Login Information
            </p>

            <table cellpadding="0" cellspacing="0" style="font-size:14px; color:#374151;">
              <tr>
                <td style="padding:4px 8px 4px 0;">Date and Time:</td>
                <td style="padding:4px 0;">${loginTime}</td>
              </tr>
              <tr>
                <td style="padding:4px 8px 4px 0;">Account Email:</td>
                <td style="padding:4px 0;">${userEmail}</td>
              </tr>
            </table>

            <p style="margin:24px 0 16px 0;">
              If you do not recognize this activity, please contact ReClaim AI support immediately.
            </p>

            <p style="margin:0;">
              Sincerely,<br />
              <strong>ReClaim AI Team</strong>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding-top:32px; font-size:12px; color:#6b7280; border-top:1px solid #e5e7eb;">
            This is an automated message. Please do not reply to this email.
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
  </body>
</html>
  `;

  return sendEmail({
    to: userEmail,
    subject: `ReClaim AI Login`,
    html,
    text: `Dear ${userName},\n\nThis email is to confirm that a successful login to your ReClaim AI account has occurred.\n\nLogin Information:\nDate and Time: ${loginTime}\nAccount Email: ${userEmail}\n\nIf you do not recognize this activity, please contact ReClaim AI support immediately.\n\nSincerely,\nReClaim AI Team\n\nThis is an automated message. Please do not reply to this email.`,
  });
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

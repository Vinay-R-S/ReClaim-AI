/**
 * Email Service - Notifications via Resend API with NodeMailer fallback
 * Primary: Resend HTTP API (works on cloud hosting)
 * Fallback: NodeMailer SMTP (works locally or with allowed SMTP)
 */

import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { escapeHtml } from '../utils/html.js';

const log = createLogger('email');

// ============ RESEND CONFIGURATION ============
const RESEND_API_KEY = env.email.resendApiKey;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Use Resend's test sender or your verified domain
const RESEND_FROM_EMAIL = env.email.fromEmail || 'ReClaim AI <onboarding@resend.dev>';

// ============ NODEMAILER CONFIGURATION (Fallback) ============
const SMTP_HOST = env.email.smtpHost;
const SMTP_PORT = env.email.smtpPort;
const SMTP_USER = env.email.smtpUser;
const SMTP_PASS = env.email.smtpPass;
const NODEMAILER_FROM_EMAIL = env.email.fromEmail || '"ReClaim AI" <noreply@reclaim.ai>';

// Create NodeMailer transporter (only if credentials exist)
const transporter =
  SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      })
    : null;

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
    log.debug('Sending email via Resend', { subject: options.subject });

    const { data, error } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      log.error('Resend error:', error);
      return false;
    }

    log.info('Email sent via Resend', { messageId: data?.id });
    return true;
  } catch (error) {
    log.error('Resend send failed:', error);
    return false;
  }
}

/**
 * Send email via NodeMailer (fallback method)
 */
async function sendViaNodeMailer(options: EmailOptions): Promise<boolean> {
  if (!transporter || !SMTP_USER || !SMTP_PASS) {
    log.warn('NodeMailer not configured, skipping fallback');
    return false;
  }

  try {
    log.debug('Sending email via NodeMailer fallback', { subject: options.subject });

    const info = await transporter.sendMail({
      from: NODEMAILER_FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    log.info('Email sent via NodeMailer', { messageId: info.messageId });
    return true;
  } catch (error) {
    log.error('NodeMailer send failed:', error);
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
    log.info('Resend failed, trying NodeMailer fallback...');
  }

  // Fallback to NodeMailer
  if (transporter) {
    const nodemailerResult = await sendViaNodeMailer(options);
    if (nodemailerResult) {
      return true;
    }
  }

  log.warn('All email transports failed, message not sent', { subject: options.subject });
  return false;
}

/**
 * Send credits earned notification
 */
export async function sendCreditsNotification(
  userEmail: string,
  creditsEarned: number,
  reason: string,
  totalCredits: number,
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
          <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
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
 * Send login notification email
 */
export async function sendLoginNotification(
  userEmail: string,
  userName: string,
  loginTime: string,
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
      <body style="margin:0; padding:0; background-color:#f6f7f9; font-family: Arial, Helvetica, sans-serif;">
        <div style="padding:20px; background-color:#fff; border-radius:8px;">
          <h2>Login Alert</h2>
          <p>Dear ${escapeHtml(userName)},</p>
          <p>A new login was detected on your account at ${escapeHtml(loginTime)}.</p>
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
  expiresAt: string,
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
          <p>Your item <strong>${escapeHtml(itemName)}</strong> has been found! Used the code below to claim it.</p>
          
          <div class="code-box">
            <div class="code">${escapeHtml(code)}</div>
            <p style="font-size: 12px; color: #666; margin-top: 5px;">Valid until ${escapeHtml(expiresAt)}</p>
          </div>

          <h3>Collection Details</h3>
          <div class="info-row">
            <div class="label">Finder's Contact:</div>
            <div>${escapeHtml(finderEmail)}</div>
          </div>
          <div class="info-row">
            <div class="label">Collection Address:</div>
            <div>${escapeHtml(collectionAddress)}</div>
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
  verificationUrl: string,
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
          <p>You are about to hand over the found item: <strong>${escapeHtml(itemName)}</strong>.</p>
          <p>When you meet the owner, ask them for their <strong>6-digit verification code</strong>.</p>
          <p>Click the button below to verify the code and complete the process:</p>
          
          <div style="text-align: center;">
            <a href="${escapeHtml(verificationUrl)}" target="_blank" rel="noopener noreferrer" class="cta-button">Verify Code & Confirm Handover</a>
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
 * Notify both parties and the admins that a handover session was blocked.
 *
 * Sent once per session, when the attempt cap is reached. No account is
 * blocked, so the message says what actually happened and who can undo it.
 */
export async function sendHandoverBlockedNotice(
  email: string,
  itemName: string,
  maxAttempts: number,
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ea4335, #fbbc05); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ea4335; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Handover Paused</h1>
        </div>
        <div class="content">
          <p>The handover for <strong>${escapeHtml(itemName)}</strong> has been paused after ${maxAttempts} incorrect verification codes.</p>
          <div class="info-box">
            <p style="margin: 0;">No account has been suspended. The verification link is simply no longer accepting codes.</p>
            <p style="margin: 10px 0 0 0;">An administrator can review the match and issue a new code.</p>
          </div>
          <p>If you were trying to complete this handover, please contact support so a new code can be issued.</p>
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
    subject: `Handover paused: ${itemName}`,
    html,
    text: `The handover for "${itemName}" was paused after ${maxAttempts} incorrect codes. No account has been suspended. An administrator can issue a new code.`,
  });
}

/**
 * Check if email service is configured (either Resend or NodeMailer)
 */
export function isEmailConfigured(): boolean {
  return !!RESEND_API_KEY || (!!SMTP_USER && !!SMTP_PASS);
}

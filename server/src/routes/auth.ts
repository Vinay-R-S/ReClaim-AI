/**
 * Auth Routes - Login notifications and authentication-related endpoints
 */

import express from 'express';
import { sendLoginNotification } from '../services/email.js';
import { collections } from '../utils/firebase-admin.js';

const router = express.Router();

/**
 * Send login notification email
 * POST /api/auth/login-notification
 */
router.post('/login-notification', async (req, res) => {
  try {
    const { userId, loginTime } = req.body;
    console.log('📨 Login notification request received:', { userId, loginTime });

    if (!userId) {
      console.log('❌ Missing userId in request');
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Get user details from Firestore instead of Firebase Admin Auth
    console.log('🔍 Looking up user in Firestore:', userId);
    const userDoc = await collections.users.doc(userId).get();
    
    if (!userDoc.exists) {
      console.log('❌ User not found in Firestore:', userId);
      return res.status(404).json({ error: 'User not found in Firestore' });
    }

    const userData = userDoc.data()!;
    const userEmail = userData.email;
    const userName = userData.displayName || userData.email?.split('@')[0] || 'User';
    
    console.log('👤 User data found:', { 
      userId, 
      userEmail: userEmail?.replace(/(.{2}).*(@)/, '$1***$2'), 
      userName 
    });

    if (!userEmail) {
      console.log('❌ User email not found in user data');
      return res.status(400).json({ error: 'User email not found' });
    }

    // Default value if not provided
    const loginTimeFormatted = loginTime || new Date().toLocaleString();

    console.log('📧 Attempting to send email to:', userEmail.replace(/(.{2}).*(@)/, '$1***$2'));

    // Send login notification email
    const emailSent = await sendLoginNotification(
      userEmail,
      userName,
      loginTimeFormatted
    );

    if (emailSent) {
      console.log('✅ Email sent successfully to:', userEmail.replace(/(.{2}).*(@)/, '$1***$2'));
      res.json({ 
        success: true, 
        message: 'Login notification sent successfully',
        userEmail: userEmail.replace(/(.{2}).*(@)/, '$1***$2') // Mask email for privacy
      });
    } else {
      console.log('❌ Failed to send email - email service may not be configured');
      res.status(500).json({ 
        error: 'Failed to send login notification email',
        message: 'Email service may not be configured'
      });
    }
  } catch (error: any) {
    console.error('💥 Login notification error:', error);
    
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

export default router;

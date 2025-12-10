// api/register-simple.js - Try this version
import admin from 'firebase-admin';

const initializeFirebase = () => {
  if (!admin.apps.length) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  return admin.database();
};

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  try {
    const db = initializeFirebase();

    // Log everything for debugging
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('Body type:', typeof req.body);

    // Try multiple ways to get data
    let username = '';
    let password = '';
    let email = '';

    // Method 1: Direct from body (if Next.js parsed it)
    if (req.body) {
      if (req.body.username) username = req.body.username;
      if (req.body.password) password = req.body.password;
      if (req.body.email) email = req.body.email;
      
      // Method 2: From data field (Sketchware)
      if (req.body.data) {
        try {
          const data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
          if (data.username) username = data.username;
          if (data.password) password = data.password;
          if (data.email) email = data.email;
        } catch (e) {
          console.log('Could not parse data field');
        }
      }
    }

    // Clean values
    username = (username || '').toString().trim();
    password = (password || '').toString();
    email = (email || '').toString().trim();

    console.log('Extracted values:', { username, password: password ? '***' : 'empty', email });

    // Basic validation
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password required',
        received: { username: username || 'missing', password: password ? '***' : 'missing' }
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username too short'
      });
    }

    // Check duplicates
    const usernameLower = username.toLowerCase();
    const snapshot = await db.ref('users')
      .orderByChild('username_lower')
      .equalTo(usernameLower)
      .once('value');

    if (snapshot.exists()) {
      return res.status(409).json({
        success: false,
        error: 'Username taken'
      });
    }

    // Create user
    const userId = `user_${Date.now()}`;
    const now = Date.now();
    
    const userData = {
      id: userId,
      username: username,
      username_lower: usernameLower,
      password: Buffer.from(password).toString('base64'),
      email: email || null,
      points: 10,
      createdAt: now,
      lastActive: now,
      isActive: true
    };

    await db.ref(`users/${userId}`).set(userData);

    return res.status(201).json({
      success: true,
      message: 'Registered!',
      userId: userId,
      username: username,
      points: 10,
      token: `token_${userId}`
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
      }

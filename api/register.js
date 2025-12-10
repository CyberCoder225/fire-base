// api/register.js
import admin from 'firebase-admin';

// Initialize Firebase
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = initializeFirebase();
    
    console.log('=== REGISTER API CALLED ===');
    console.log('Headers:', JSON.stringify(req.headers));
    console.log('Body:', req.body);
    console.log('Body type:', typeof req.body);

    let username, password, email;

    // Handle different formats
    if (req.body) {
      // Format 1: Direct fields (username, password, email)
      if (req.body.username && req.body.password) {
        username = req.body.username;
        password = req.body.password;
        email = req.body.email;
        console.log('Using direct fields format');
      }
      // Format 2: JSON string in "data" field (old Sketchware)
      else if (req.body.data) {
        console.log('Found data field:', req.body.data);
        try {
          const data = typeof req.body.data === 'string' 
            ? JSON.parse(req.body.data) 
            : req.body.data;
          
          username = data.username;
          password = data.password;
          email = data.email;
          console.log('Using data field format');
        } catch (e) {
          console.error('Error parsing data field:', e);
        }
      }
      // Format 3: Raw JSON body
      else if (typeof req.body === 'object' && req.body.username) {
        username = req.body.username;
        password = req.body.password;
        email = req.body.email;
        console.log('Using raw JSON format');
      }
    }

    console.log('Extracted values:', {
      username: username || 'NOT FOUND',
      password: password ? '***' : 'NOT FOUND',
      email: email || 'NOT FOUND'
    });

    // Validate
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required',
        debug: {
          received: req.body,
          extracted: { username, password, email }
        }
      });
    }

    // Clean values
    username = username.toString().trim();
    password = password.toString();
    email = email ? email.toString().trim() : null;

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters'
      });
    }

    // Check for existing user
    const usernameLower = username.toLowerCase();
    const snapshot = await db.ref('users')
      .orderByChild('username_lower')
      .equalTo(usernameLower)
      .once('value');

    if (snapshot.exists()) {
      return res.status(409).json({
        success: false,
        error: 'Username already exists'
      });
    }

    // Create user
    const userId = db.ref('users').push().key;
    const now = Date.now();
    
    const userData = {
      id: userId,
      username: username,
      username_lower: usernameLower,
      password: Buffer.from(password).toString('base64'),
      email: email,
      points: 10,
      submissions: 0,
      createdAt: now,
      lastActive: now,
      isActive: true,
      role: 'user'
    };

    await db.ref(`users/${userId}`).set(userData);
    
    console.log('User created successfully:', userId);

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      userId: userId,
      username: username,
      points: 10,
      token: `user_${userId}_${now}`
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
        }

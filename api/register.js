// api/register.js
import admin from 'firebase-admin';

// Initialize Firebase
try {
  if (!admin.apps.length) {
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('✅ Firebase initialized');
  }
} catch (error) {
  console.error('❌ Firebase init error:', error);
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Only POST requests allowed' 
    });
  }
  
  console.log('📨 Registration request received');
  
  try {
    // Get the database reference
    const db = admin.database();
    
    // Parse request data
    let username, password, email;
    
    // Check if body exists
    if (!req.body) {
      return res.status(400).json({
        success: false,
        error: 'No data received'
      });
    }
    
    console.log('Raw body:', JSON.stringify(req.body));
    
    // Handle Sketchware format: {data: '{"username":"...","password":"...","email":"..."}'}
    if (req.body.data) {
      try {
        const data = typeof req.body.data === 'string' 
          ? JSON.parse(req.body.data) 
          : req.body.data;
        
        username = data.username;
        password = data.password;
        email = data.email;
      } catch (e) {
        console.error('Failed to parse data:', e);
      }
    }
    
    // Fallback to direct fields
    if (!username && req.body.username) {
      username = req.body.username;
      password = req.body.password;
      email = req.body.email;
    }
    
    console.log('Parsed data:', { username, password: password ? '***' : 'missing', email });
    
    // Validate
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }
    
    // Clean data
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
        error: 'Username already taken'
      });
    }
    
    // Create user
    const userId = db.ref('users').push().key;
    const now = Date.now();
    
    const userData = {
      id: userId,
      username: username,
      username_lower: usernameLower,
      password: Buffer.from(password).toString('base64'), // Simple encoding
      email: email,
      points: 10,
      submissions: 0,
      createdAt: now,
      lastActive: now,
      isActive: true,
      role: 'user'
    };
    
    // Save to Firebase
    await db.ref(`users/${userId}`).set(userData);
    
    console.log('✅ User created:', userId);
    
    // Return success
    return res.status(201).json({
      success: true,
      message: 'Registration successful!',
      userId: userId,
      username: username,
      points: 10,
      token: `user_${userId}_${now}`
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Registration failed',
      message: error.message
    });
  }
        }

// api/register-debug.js
import admin from 'firebase-admin';

console.log('=== API LOADED ===');

// Initialize Firebase
const initializeFirebase = () => {
  console.log('Initializing Firebase...');
  
  try {
    if (!admin.apps.length) {
      console.log('No Firebase apps, creating new one...');
      
      // Check environment variables
      console.log('Checking env vars...');
      console.log('Project ID exists:', !!process.env.FIREBASE_PROJECT_ID);
      console.log('Client Email exists:', !!process.env.FIREBASE_CLIENT_EMAIL);
      console.log('Private Key exists:', !!process.env.FIREBASE_PRIVATE_KEY);
      console.log('Database URL exists:', !!process.env.FIREBASE_DATABASE_URL);
      
      if (!process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('FIREBASE_PRIVATE_KEY is not set');
      }
      
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      console.log('Private key length:', privateKey.length);
      
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
      
      console.log('Firebase initialized successfully');
    } else {
      console.log('Firebase already initialized');
    }
    
    return admin.database();
  } catch (error) {
    console.error('Firebase initialization error:', error);
    throw error;
  }
};

export default async function handler(req, res) {
  console.log('\n=== NEW REQUEST ===');
  console.log('Time:', new Date().toISOString());
  console.log('Method:', req.method);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request, returning 200');
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    console.log('Request body:', req.body);
    console.log('Content-Type:', req.headers['content-type']);
    
    // Try to initialize Firebase
    let db;
    try {
      db = initializeFirebase();
      console.log('Firebase DB initialized');
    } catch (firebaseError) {
      console.error('Firebase init failed:', firebaseError);
      return res.status(500).json({
        success: false,
        error: 'Firebase initialization failed',
        message: firebaseError.message
      });
    }
    
    // Parse request data
    let username, password, email;
    
    if (req.body && req.body.username && req.body.password) {
      // Direct parameters
      username = req.body.username;
      password = req.body.password;
      email = req.body.email;
      console.log('Using direct parameters');
    } else if (req.body && req.body.data) {
      // Data parameter (Sketchware format)
      console.log('Found data parameter:', req.body.data);
      try {
        const data = typeof req.body.data === 'string' 
          ? JSON.parse(req.body.data) 
          : req.body.data;
        username = data.username;
        password = data.password;
        email = data.email;
        console.log('Parsed data parameter');
      } catch (parseError) {
        console.error('Failed to parse data:', parseError);
        return res.status(400).json({
          success: false,
          error: 'Invalid JSON in data parameter'
        });
      }
    } else {
      console.log('No valid data found in request');
      return res.status(400).json({
        success: false,
        error: 'No valid data provided',
        received: req.body
      });
    }
    
    console.log('Extracted values:', {
      username: username || 'NOT FOUND',
      password: password ? '***' : 'NOT FOUND',
      email: email || 'NOT PROVIDED'
    });
    
    // Validate
    if (!username || !password) {
      console.log('Validation failed: missing username or password');
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }
    
    username = username.toString().trim();
    password = password.toString();
    email = email ? email.toString().trim() : null;
    
    if (username.length < 3) {
      console.log('Validation failed: username too short');
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters'
      });
    }
    
    // Check for existing user
    console.log('Checking for duplicate username:', username.toLowerCase());
    try {
      const snapshot = await db.ref('users')
        .orderByChild('username_lower')
        .equalTo(username.toLowerCase())
        .once('value');
      
      console.log('Duplicate check result:', snapshot.exists());
      
      if (snapshot.exists()) {
        return res.status(409).json({
          success: false,
          error: 'Username already taken'
        });
      }
    } catch (dbError) {
      console.error('Database query error:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Database error during duplicate check',
        message: dbError.message
      });
    }
    
    // Create user
    console.log('Creating new user...');
    const userId = db.ref('users').push().key;
    const now = Date.now();
    
    console.log('Generated User ID:', userId);
    
    const userData = {
      id: userId,
      username: username,
      username_lower: username.toLowerCase(),
      password: Buffer.from(password).toString('base64'),
      email: email,
      points: 10,
      submissions: 0,
      createdAt: now,
      lastActive: now,
      isActive: true,
      role: 'user'
    };
    
    console.log('User data to save:', userData);
    
    // Save to Firebase
    try {
      await db.ref(`users/${userId}`).set(userData);
      console.log('User saved successfully!');
    } catch (saveError) {
      console.error('Failed to save user:', saveError);
      return res.status(500).json({
        success: false,
        error: 'Failed to save user to database',
        message: saveError.message
      });
    }
    
    // Success response
    const response = {
      success: true,
      message: 'User registered successfully',
      userId: userId,
      username: username,
      points: 10,
      token: `user_${userId}_${now}`
    };
    
    console.log('Sending success response:', response);
    return res.status(201).json(response);
    
  } catch (error) {
    console.error('=== UNEXPECTED ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('=======================');
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
      }

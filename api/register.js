// api/register.js
import admin from 'firebase-admin';

console.log('=== REGISTER API LOADED ===');

// Initialize Firebase (do it once globally)
let firebaseInitialized = false;
let db = null;

const initializeFirebase = () => {
  if (firebaseInitialized && db) {
    return db;
  }
  
  console.log('Initializing Firebase...');
  
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      console.log('Creating new Firebase app...');
      
      // Get environment variables
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;
      const databaseURL = process.env.FIREBASE_DATABASE_URL;
      
      console.log('Project ID:', projectId);
      console.log('Client Email:', clientEmail);
      console.log('Private Key length:', privateKey?.length);
      console.log('Database URL:', databaseURL);
      
      if (!projectId || !clientEmail || !privateKey || !databaseURL) {
        throw new Error('Missing required Firebase environment variables');
      }
      
      // Format the private key (handle escaped newlines)
      const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
      
      // Initialize Firebase Admin SDK
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: formattedPrivateKey
        }),
        databaseURL: databaseURL
      });
      
      console.log('✅ Firebase Admin SDK initialized successfully');
    } else {
      console.log('✅ Firebase already initialized');
    }
    
    // Get database reference
    db = admin.database();
    firebaseInitialized = true;
    
    console.log('✅ Database reference obtained');
    return db;
    
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
};

// Initialize Firebase when the module loads
try {
  db = initializeFirebase();
  console.log('✅ Firebase ready on module load');
} catch (error) {
  console.error('❌ Failed to initialize Firebase on load:', error.message);
}

export default async function handler(req, res) {
  console.log('\n' + '='.repeat(50));
  console.log('📨 NEW REGISTRATION REQUEST');
  console.log('Time:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Path:', req.url);
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('🔄 Handling OPTIONS (preflight)');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  
  // Only allow POST
  if (req.method !== 'POST') {
    console.log('❌ Method not allowed:', req.method);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ 
      success: false, 
      error: `Method ${req.method} not allowed. Only POST is accepted.`
    });
  }
  
  // Set CORS headers for the actual response
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    // Ensure Firebase is initialized
    if (!db) {
      console.log('🔄 Initializing Firebase on request...');
      db = initializeFirebase();
    }
    
    console.log('📝 Request body:', JSON.stringify(req.body, null, 2));
    console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
    
    // Parse the request data - your Android app sends {data: '{"username":"...","password":"...","email":"..."}'}
    let username, password, email;
    
    if (req.body && typeof req.body === 'object') {
      // Method 1: Check for "data" parameter (Sketchware format)
      if (req.body.data) {
        console.log('📦 Found "data" parameter');
        
        try {
          let data;
          if (typeof req.body.data === 'string') {
            console.log('📝 Data is string, parsing JSON...');
            data = JSON.parse(req.body.data);
          } else {
            console.log('📝 Data is already object');
            data = req.body.data;
          }
          
          username = data.username;
          password = data.password;
          email = data.email;
          
          console.log('✅ Successfully parsed data parameter');
        } catch (parseError) {
          console.error('❌ Failed to parse data:', parseError.message);
          console.error('Raw data:', req.body.data);
        }
      }
      
      // Method 2: Direct parameters (fallback)
      if (!username && req.body.username) {
        username = req.body.username;
        password = req.body.password;
        email = req.body.email;
        console.log('📦 Using direct parameters');
      }
    }
    
    console.log('🎯 Extracted values:', {
      username: username || '(not found)',
      password: password ? '***' : '(not found)',
      email: email || '(not provided)'
    });
    
    // Validate required fields
    if (!username || !password) {
      console.log('❌ Validation failed: Missing username or password');
      return res.status(400).json({
        success: false,
        error: 'Username and password are required',
        debug: {
          receivedBody: req.body,
          extracted: { username, password, email }
        }
      });
    }
    
    // Clean and validate
    username = username.toString().trim();
    password = password.toString();
    email = email ? email.toString().trim() : null;
    
    if (username.length < 3) {
      console.log('❌ Validation failed: Username too short');
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters'
      });
    }
    
    // Check for duplicate username
    const usernameLower = username.toLowerCase();
    console.log('🔍 Checking for duplicate username:', usernameLower);
    
    try {
      const snapshot = await db.ref('users')
        .orderByChild('username_lower')
        .equalTo(usernameLower)
        .once('value');
      
      if (snapshot.exists()) {
        console.log('❌ Username already exists:', usernameLower);
        return res.status(409).json({
          success: false,
          error: 'Username already taken',
          suggestions: [
            `${username}123`,
            `${username}_${Math.floor(Math.random() * 1000)}`,
            `TheReal${username}`
          ]
        });
      }
      
      console.log('✅ Username is available');
    } catch (dbError) {
      console.error('❌ Database error during duplicate check:', dbError.message);
      return res.status(500).json({
        success: false,
        error: 'Database error',
        message: dbError.message
      });
    }
    
    // Create new user
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    
    console.log('👤 Creating user with ID:', userId);
    
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
    
    console.log('💾 Saving user data:', JSON.stringify(userData, null, 2));
    
    // Save to Firebase
    try {
      await db.ref(`users/${userId}`).set(userData);
      console.log('✅ User saved successfully to Firebase!');
    } catch (saveError) {
      console.error('❌ Failed to save user:', saveError.message);
      console.error('Stack:', saveError.stack);
      return res.status(500).json({
        success: false,
        error: 'Failed to save user data',
        message: saveError.message
      });
    }
    
    // Create success response
    const response = {
      success: true,
      message: '🎉 Registration successful!',
      userId: userId,
      username: username,
      points: 10,
      token: `user_${userId}_${now}`
    };
    
    console.log('📤 Sending success response:', JSON.stringify(response, null, 2));
    console.log('='.repeat(50) + '\n');
    
    return res.status(201).json(response);
    
  } catch (error) {
    console.error('\n❌❌❌ UNEXPECTED ERROR ❌❌❌');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(50));
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
    }

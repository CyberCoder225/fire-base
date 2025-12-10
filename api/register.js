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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  try {
    const db = initializeFirebase();

    // FIRST: Check if body is empty
    if (!req.body) {
      return res.status(400).json({ 
        success: false, 
        error: 'Empty request body' 
      });
    }

    console.log('=== RAW REQUEST BODY ===');
    console.log('Type:', typeof req.body);
    console.log('Body:', req.body);
    console.log('Body keys:', Object.keys(req.body));
    console.log('======================');

    // Your Android app sends: { data: '{"username":"test","password":"123","email":"test_123@pro-faira.com"}' }
    // So we need to extract the "data" field and parse it
    
    let jsonData = {};
    
    // CASE 1: If "data" field exists and is a string (Sketchware format)
    if (req.body.data) {
      console.log('Found "data" field:', req.body.data);
      console.log('Type of data field:', typeof req.body.data);
      
      if (typeof req.body.data === 'string') {
        try {
          jsonData = JSON.parse(req.body.data);
          console.log('Parsed data successfully:', jsonData);
        } catch (e) {
          console.error('Failed to parse data as JSON:', e.message);
          return res.status(400).json({ 
            success: false, 
            error: 'Invalid JSON in data field',
            details: e.message
          });
        }
      } else if (typeof req.body.data === 'object') {
        // If data is already an object
        jsonData = req.body.data;
        console.log('Data is already object:', jsonData);
      }
    } 
    // CASE 2: If fields are sent directly (not wrapped in "data")
    else if (req.body.username || req.body.password) {
      console.log('Found direct fields in body');
      jsonData = req.body;
    }
    // CASE 3: Body might be a JSON string directly
    else if (typeof req.body === 'string') {
      try {
        console.log('Body is string, parsing directly');
        const parsedBody = JSON.parse(req.body);
        if (parsedBody.data) {
          if (typeof parsedBody.data === 'string') {
            jsonData = JSON.parse(parsedBody.data);
          } else {
            jsonData = parsedBody.data;
          }
        } else {
          jsonData = parsedBody;
        }
      } catch (e) {
        console.error('Failed to parse body as JSON:', e.message);
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid JSON request body'
        });
      }
    } else {
      console.log('No recognizable data format');
      return res.status(400).json({ 
        success: false, 
        error: 'Unknown data format',
        received: req.body
      });
    }

    console.log('Final parsed data:', jsonData);

    // Extract fields with defaults
    const username = (jsonData.username || '').trim();
    const password = jsonData.password || '';
    const email = (jsonData.email || '').trim();

    console.log('Extracted fields:', { username, password: password ? '***' : 'empty', email });

    // Validation
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username and password are required',
        received: { 
          username: username || 'missing', 
          password: password ? '***' : 'missing',
          email: email || 'missing'
        }
      });
    }

    if (username.length < 3) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username must be at least 3 characters' 
      });
    }

    // Check for duplicates
    const usernameLower = username.toLowerCase();
    console.log('Checking for duplicate username:', usernameLower);
    
    const snapshot = await db.ref('users')
      .orderByChild('username_lower')
      .equalTo(usernameLower)
      .once('value');

    if (snapshot.exists()) {
      console.log('Username already exists:', usernameLower);
      return res.status(409).json({
        success: false,
        error: 'Username already taken',
        suggestions: [
          `${username}123`,
          `${username}_${Math.floor(Math.random() * 1000)}`,
          `TheReal${username}`,
          `${username}${new Date().getFullYear()}`
        ]
      });
    }

    console.log('Username is available, creating user...');

    // Create user
    const userId = db.ref('users').push().key;
    const now = Date.now();

    // Simple password hash
    const passwordHash = Buffer.from(password).toString('base64');

    const userData = {
      id: userId,
      username: username,
      username_lower: usernameLower,
      password: passwordHash,
      email: email || null,
      points: 10,
      submissions: 0,
      createdAt: now,
      lastActive: now,
      isActive: true,
      role: 'user'
    };

    console.log('Saving user to Firebase:', { userId, username });
    
    await db.ref(`users/${userId}`).set(userData);
    console.log('User saved successfully!');

    // Success response
    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      userId: userId,
      username: username,
      points: 10,
      token: `user_${userId}_${now}`
    });

  } catch (error) {
    console.error('=== REGISTRATION ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('=======================');
    
    return res.status(500).json({
      success: false,
      error: 'Registration failed',
      message: error.message
    });
  }
      }

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

    console.log('=== REQUEST RECEIVED ===');
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Raw body:', req.body);
    console.log('=======================');

    let jsonData = {};
    
    // Your Android app sends form-urlencoded: data={"username":"...","password":"...","email":"..."}
    if (req.body && req.body.data) {
      console.log('Found data field:', req.body.data);
      
      if (typeof req.body.data === 'string') {
        try {
          // Parse the JSON string inside the data parameter
          jsonData = JSON.parse(req.body.data);
          console.log('Parsed data successfully:', jsonData);
        } catch (e) {
          console.error('Failed to parse JSON in data field:', e.message);
          console.error('Raw data string:', req.body.data);
          
          return res.status(400).json({ 
            success: false, 
            error: 'Invalid JSON format in data field'
          });
        }
      } else {
        // If data is already an object (unlikely with Sketchware)
        jsonData = req.body.data;
      }
    } else {
      console.log('No data field found in request');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing data parameter',
        received: req.body
      });
    }

    // Extract values
    const username = (jsonData.username || '').trim();
    const password = jsonData.password || '';
    const email = (jsonData.email || '').trim();

    console.log('Extracted:', { 
      username: username || '(empty)', 
      password: password ? '***' : '(empty)', 
      email: email || '(empty)' 
    });

    // Validation
    if (!username) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username is required'
      });
    }
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password is required'
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
    console.log('Checking for username:', usernameLower);
    
    const snapshot = await db.ref('users')
      .orderByChild('username_lower')
      .equalTo(usernameLower)
      .once('value');

    if (snapshot.exists()) {
      console.log('Username already exists');
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

    console.log('Creating new user...');
    
    // Create user ID
    const newUserRef = db.ref('users').push();
    const userId = newUserRef.key;
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

    console.log('Saving user to Firebase...');
    
    // Save to Firebase
    await newUserRef.set(userData);
    
    console.log('User saved successfully! User ID:', userId);

    // Return success - match the exact fields your Android app expects
    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      userId: userId,  // Your app expects this
      username: username,  // Your app expects this
      points: 10,  // Your app expects this
      token: `user_${userId}_${now}`  // Your app expects this
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

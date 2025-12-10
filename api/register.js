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

// Helper to parse raw body
function parseBody(req) {
  const contentType = req.headers['content-type'] || '';
  
  if (contentType.includes('application/x-www-form-urlencoded')) {
    // Parse form data
    const params = new URLSearchParams(req.body);
    const result = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  }
  
  // If it's already parsed by Next.js, return as-is
  if (typeof req.body === 'object' && req.body !== null) {
    return req.body;
  }
  
  // Try to parse as JSON
  try {
    return JSON.parse(req.body || '{}');
  } catch (e) {
    return {};
  }
}

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
    console.log('Raw body type:', typeof req.body);
    console.log('Raw body:', req.body);
    console.log('=======================');

    // Parse the body based on content type
    const parsedBody = parseBody(req);
    console.log('Parsed body:', parsedBody);
    console.log('Parsed body keys:', Object.keys(parsedBody));

    let jsonData = {};
    
    // Handle Sketchware format - data field containing JSON string
    if (parsedBody.data) {
      console.log('Found data field:', parsedBody.data);
      
      if (typeof parsedBody.data === 'string') {
        try {
          jsonData = JSON.parse(parsedBody.data);
          console.log('Successfully parsed data field as JSON');
        } catch (e) {
          console.error('Failed to parse data field:', e.message);
          
          // If parsing fails, try to extract values directly
          if (parsedBody.username) {
            jsonData = {
              username: parsedBody.username,
              password: parsedBody.password,
              email: parsedBody.email
            };
          }
        }
      } else {
        // If data is already an object
        jsonData = parsedBody.data;
      }
    } 
    // Check if fields are sent directly
    else if (parsedBody.username || parsedBody.password) {
      console.log('Found direct fields');
      jsonData = parsedBody;
    }
    // If body is the JSON directly
    else if (typeof parsedBody === 'object' && parsedBody.username) {
      jsonData = parsedBody;
    }
    
    console.log('Final jsonData:', jsonData);

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
        error: 'Username is required',
        debug: { received: jsonData }
      });
    }
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password is required',
        debug: { received: jsonData }
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
        error: 'Username already taken'
      });
    }

    console.log('Creating new user...');
    
    // Create user ID
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

    console.log('Saving user:', userData);
    
    // Save to Firebase
    await db.ref(`users/${userId}`).set(userData);
    
    console.log('User saved successfully!');

    // Return success
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
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('=======================');
    
    return res.status(500).json({
      success: false,
      error: 'Registration failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

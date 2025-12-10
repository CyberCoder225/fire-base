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

    // --- Handle old Sketchware POST with data=<JSON>
    let jsonData;
    try {
      jsonData = req.body.data ? JSON.parse(req.body.data) : req.body;
    } catch (e) {
      return res.status(400).json({ success: false, error: "Invalid JSON" });
    }

    const { username, password, email } = jsonData;

    // Validation
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
    }

    // Check for duplicates
    const usernameLower = username.toLowerCase();
    const snapshot = await db.ref('users')
      .orderByChild('username_lower')
      .equalTo(usernameLower)
      .once('value');

    if (snapshot.exists()) {
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

    // Create user
    const userId = db.ref('users').push().key;
    const now = Date.now();

    // Simple password hash (for demo; use bcrypt in production)
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

    await db.ref(`users/${userId}`).set(userData);

    // Success response
    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      userId: userId,
      username: username,
      points: 10,
      token: `user_${userId}_${now}` // simple token
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Registration failed',
      message: error.message
    });
  }
                                    }

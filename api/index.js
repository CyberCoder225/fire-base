// api/index.js - With Firebase Authentication
import admin from 'firebase-admin';
import { createHash, createHmac } from 'crypto';

// Initialize Firebase Admin SDK
const initializeFirebase = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  return {
    db: admin.database(),
    auth: admin.auth()
  };
};

// ====================
// SECURITY & UTILITIES
// ====================
const SECURITY_CONFIG = {
  maxUsernameLength: 20,
  minPasswordLength: 6,
  allowedUsernameRegex: /^[a-zA-Z0-9_]+$/
};

// Rate limiting
const requestCounts = new Map();
const checkRateLimit = (ip) => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const windowStart = now - windowMs;
  
  requestCounts.forEach((data, key) => {
    if (data.timestamp < windowStart) requestCounts.delete(key);
  });
  
  const userData = requestCounts.get(ip) || { count: 0, timestamp: now };
  if (userData.count >= 100) return false;
  
  requestCounts.set(ip, { count: userData.count + 1, timestamp: now });
  return true;
};

// Verify Firebase ID Token
const verifyIdToken = async (auth, idToken) => {
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    return { success: true, uid: decodedToken.uid, email: decodedToken.email };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ====================
// TRENDING ALGORITHMS
// ====================
const calculateTrendingScore = (user, algorithm = 'hackernews') => {
  const now = Date.now();
  const ageInHours = (now - (user.createdAt || now)) / (1000 * 60 * 60);
  const points = user.points || 0;
  const submissions = user.submissions || 0;
  
  switch (algorithm) {
    case 'reddit':
      const order = Math.log10(Math.max(Math.abs(points), 1));
      const sign = points > 0 ? 1 : -1;
      const seconds = ageInHours * 3600;
      return sign * order + seconds / 45000;
      
    case 'velocity':
      const pointsPerHour = points / Math.max(1, ageInHours);
      const submissionsPerHour = submissions / Math.max(1, ageInHours);
      return pointsPerHour * (1 + submissionsPerHour);
      
    case 'hackernews':
    default:
      const gravity = 1.8;
      const score = (points + submissions * 2);
      return score / Math.pow(ageInHours + 2, gravity);
  }
};

// ====================
// MAIN API HANDLER
// ====================
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Rate limiting
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests'
    });
  }
  
  // Initialize Firebase
  let firebase;
  try {
    firebase = initializeFirebase();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Firebase initialization failed'
    });
  }
  
  const { db, auth } = firebase;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const query = Object.fromEntries(url.searchParams);
  
  try {
    switch (path) {
      case '/':
        return res.json({
          status: 'API Running with Firebase Auth',
          endpoints: [
            '/register (POST)',
            '/login (POST)',
            '/auth/verify (POST)',
            '/auth/create-user (POST)',
            '/check-duplicate (POST)',
            '/trending (GET)',
            '/leaderboard (GET)',
            '/health (GET)'
          ]
        });
        
      case '/register':
        return await handleRegister(req, res, db, auth);
        
      case '/login':
        return await handleLogin(req, res, db, auth);
        
      case '/auth/verify':
        return await handleVerifyToken(req, res, auth);
        
      case '/auth/create-user':
        return await handleCreateAuthUser(req, res, auth, db);
        
      case '/check-duplicate':
        return await handleCheckDuplicate(req, res, db);
        
      case '/trending':
        return await handleTrending(req, res, db, query);
        
      case '/leaderboard':
        return await handleLeaderboard(req, res, db, query);
        
      case '/health':
        return await handleHealth(req, res, db);
        
      default:
        return res.status(404).json({
          success: false,
          error: 'Endpoint not found'
        });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// ====================
// AUTHENTICATION ENDPOINTS
// ====================

// 1. REGISTER WITH FIREBASE AUTH
async function handleRegister(req, res, db, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { email, password, username } = req.body || JSON.parse(req.body || '{}');
    
    if (!email || !password || !username) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and username are required'
      });
    }
    
    // Validate username
    if (username.length < 3) {
      return res.status(400).json({
        error: 'Username must be at least 3 characters'
      });
    }
    
    // Check for duplicate username in database
    const usernameSnapshot = await db.ref('users')
      .orderByChild('username')
      .equalTo(username)
      .once('value');
    
    if (usernameSnapshot.exists()) {
      return res.status(409).json({
        success: false,
        error: 'Username already taken'
      });
    }
    
    // Create user in Firebase Authentication
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email,
        password,
        displayName: username,
        emailVerified: false,
        disabled: false
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        return res.status(409).json({
          success: false,
          error: 'Email already registered'
        });
      }
      throw authError;
    }
    
    // Create custom token for the user
    const customToken = await auth.createCustomToken(userRecord.uid);
    
    // Save user data to Realtime Database
    const userData = {
      uid: userRecord.uid,
      username,
      email,
      points: 10,
      submissions: 0,
      createdAt: Date.now(),
      lastActive: Date.now(),
      emailVerified: userRecord.emailVerified,
      isActive: true
    };
    
    await db.ref(`users/${userRecord.uid}`).set(userData);
    
    // Create a profile entry
    await db.ref(`profiles/${userRecord.uid}`).set({
      username,
      createdAt: Date.now(),
      bio: '',
      avatar: ''
    });
    
    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        uid: userRecord.uid,
        username,
        email,
        customToken,
        points: 10
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// 2. LOGIN WITH FIREBASE AUTH (Client-side should use Firebase SDK)
async function handleLogin(req, res, db, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { idToken } = req.body || JSON.parse(req.body || '{}');
    
    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'ID token is required'
      });
    }
    
    // Verify the ID token
    const tokenResult = await verifyIdToken(auth, idToken);
    if (!tokenResult.success) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    const { uid, email } = tokenResult;
    
    // Get user data from database
    const userSnapshot = await db.ref(`users/${uid}`).once('value');
    if (!userSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: 'User not found in database'
      });
    }
    
    const userData = userSnapshot.val();
    
    // Update last active timestamp
    await db.ref(`users/${uid}`).update({
      lastActive: Date.now()
    });
    
    // Create a new custom token
    const customToken = await auth.createCustomToken(uid);
    
    return res.json({
      success: true,
      data: {
        uid,
        username: userData.username,
        email,
        points: userData.points || 0,
        customToken,
        lastActive: userData.lastActive
      }
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// 3. VERIFY TOKEN
async function handleVerifyToken(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { idToken } = req.body || JSON.parse(req.body || '{}');
    
    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'ID token is required'
      });
    }
    
    const tokenResult = await verifyIdToken(auth, idToken);
    
    return res.json({
      success: tokenResult.success,
      data: tokenResult.success ? {
        uid: tokenResult.uid,
        email: tokenResult.email,
        valid: true
      } : {
        valid: false,
        error: tokenResult.error
      }
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// 4. CREATE AUTH USER (Admin only - for manual user creation)
async function handleCreateAuthUser(req, res, auth, db) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Check for admin authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Admin authorization required'
      });
    }
    
    const adminToken = authHeader.split('Bearer ')[1];
    const adminResult = await verifyIdToken(auth, adminToken);
    
    if (!adminResult.success) {
      return res.status(401).json({
        success: false,
        error: 'Invalid admin token'
      });
    }
    
    const { email, password, username } = req.body || JSON.parse(req.body || '{}');
    
    if (!email || !password || !username) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and username are required'
      });
    }
    
    // Create user in Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: username
    });
    
    // Create in database
    const userData = {
      uid: userRecord.uid,
      username,
      email,
      points: 10,
      createdAt: Date.now(),
      isActive: true,
      createdByAdmin: adminResult.uid
    };
    
    await db.ref(`users/${userRecord.uid}`).set(userData);
    
    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        uid: userRecord.uid,
        username,
        email
      }
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// ====================
// OTHER ENDPOINTS
// ====================

// 5. CHECK DUPLICATE
async function handleCheckDuplicate(req, res, db) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { field, value } = req.body || JSON.parse(req.body || '{}');
    
    if (!field || !value) {
      return res.status(400).json({ error: 'Field and value required' });
    }
    
    const snapshot = await db.ref('users')
      .orderByChild(field)
      .equalTo(value)
      .once('value');
    
    const duplicates = [];
    snapshot.forEach(child => {
      duplicates.push({
        id: child.key,
        username: child.val().username,
        [field]: value
      });
    });
    
    return res.json({
      success: true,
      hasDuplicates: duplicates.length > 0,
      count: duplicates.length,
      duplicates
    });
    
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// 6. TRENDING
async function handleTrending(req, res, db, query) {
  const { limit = 10, timeframe = '24h', algorithm = 'hackernews' } = query;
  const now = Date.now();
  
  const timeThreshold = {
    '1h': now - (60 * 60 * 1000),
    '6h': now - (6 * 60 * 60 * 1000),
    '12h': now - (12 * 60 * 60 * 1000),
    '24h': now - (24 * 60 * 60 * 1000),
    '7d': now - (7 * 24 * 60 * 60 * 1000)
  }[timeframe] || (now - (24 * 60 * 60 * 1000));
  
  const snapshot = await db.ref('users').once('value');
  const users = [];
  
  snapshot.forEach(child => {
    const user = child.val();
    if (user.createdAt && user.createdAt > timeThreshold && user.isActive !== false) {
      const trendScore = calculateTrendingScore(user, algorithm);
      
      users.push({
        id: child.key,
        username: user.username,
        points: user.points || 0,
        submissions: user.submissions || 0,
        trendScore: parseFloat(trendScore.toFixed(4)),
        createdAt: user.createdAt
      });
    }
  });
  
  users.sort((a, b) => b.trendScore - a.trendScore);
  
  return res.json({
    success: true,
    timeframe,
    algorithm,
    total: users.length,
    trending: users.slice(0, parseInt(limit)).map((user, index) => ({
      rank: index + 1,
      ...user
    }))
  });
}

// 7. LEADERBOARD
async function handleLeaderboard(req, res, db, query) {
  const { limit = 20, sortBy = 'points' } = query;
  
  const snapshot = await db.ref('users').once('value');
  const users = [];
  
  snapshot.forEach(child => {
    const user = child.val();
    if (user.isActive !== false) {
      users.push({
        id: child.key,
        username: user.username,
        points: user.points || 0,
        submissions: user.submissions || 0,
        createdAt: user.createdAt
      });
    }
  });
  
  users.sort((a, b) => {
    if (sortBy === 'points') return b.points - a.points;
    if (sortBy === 'submissions') return b.submissions - a.submissions;
    if (sortBy === 'recent') return b.createdAt - a.createdAt;
    return b.points - a.points;
  });
  
  return res.json({
    success: true,
    sortBy,
    total: users.length,
    leaderboard: users.slice(0, parseInt(limit)).map((user, index) => ({
      rank: index + 1,
      ...user
    }))
  });
}

// 8. HEALTH
async function handleHealth(req, res, db) {
  const snapshot = await db.ref('users').once('value');
  const stats = {
    totalUsers: snapshot.numChildren(),
    activeUsers: 0,
    totalPoints: 0,
    timestamp: new Date().toISOString()
  };
  
  snapshot.forEach(child => {
    const user = child.val();
    if (user.isActive !== false) {
      stats.activeUsers++;
      stats.totalPoints += user.points || 0;
    }
  });
  
  stats.averagePoints = stats.activeUsers > 0 
    ? Math.round(stats.totalPoints / stats.activeUsers) 
    : 0;
  
  return res.json({
    success: true,
    status: 'healthy',
    ...stats
  });
    }

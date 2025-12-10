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

// Vercel provides req.query automatically - use that!
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Only GET allowed. Use query parameters like ?algorithm=top&limit=5'
    });
  }
  
  try {
    const db = initializeFirebase();
    
    // Vercel automatically parses query string into req.query
    const { 
      algorithm = 'trending',
      limit = 20,
      timeframe = 'all',
      minPoints = 0
    } = req.query;
    
    // Simple trending calculation
    const calculateScore = (user, algo) => {
      const now = Date.now();
      const points = user.points || 0;
      const submissions = user.submissions || 0;
      const createdAt = user.createdAt || now;
      
      switch(algo) {
        case 'new':
          return -createdAt; // Negative for newest first
        case 'top':
          return points;
        case 'active':
          return submissions;
        case 'efficient':
          const ageInDays = (now - createdAt) / (1000 * 60 * 60 * 24);
          return points / Math.max(1, ageInDays);
        case 'recent':
          return user.lastActive || createdAt;
        case 'trending':
        default:
          const ageInHours = (now - createdAt) / (1000 * 60 * 60);
          const gravity = 1.8;
          return (points + submissions * 2) / Math.pow(ageInHours + 2, gravity);
      }
    };
    
    // Get users
    const snapshot = await db.ref('users').once('value');
    const users = [];
    
    snapshot.forEach(child => {
      const user = child.val();
      if (!user || user.isActive === false) return;
      
      const score = calculateScore(user, algorithm);
      
      users.push({
        id: child.key,
        username: user.username || 'Anonymous',
        points: user.points || 0,
        submissions: user.submissions || 0,
        score: parseFloat(score.toFixed(4))
      });
    });
    
    // Sort
    users.sort((a, b) => b.score - a.score);
    
    // Apply limit
    const limitNum = parseInt(limit) || 20;
    const result = users.slice(0, limitNum);
    
    return res.json({
      success: true,
      algorithm: algorithm,
      totalUsers: users.length,
      showing: result.length,
      users: result.map((user, index) => ({
        rank: index + 1,
        ...user
      }))
    });
    
  } catch (error) {
    console.error('Sort error:', error);
    return res.json({
      success: false,
      error: 'Sorting failed',
      details: error.message
    });
  }
      }

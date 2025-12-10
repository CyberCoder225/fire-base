import admin from 'firebase-admin';

// Initialize Firebase
const initializeFirebase = () => {
  if (!admin.apps.length) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
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
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Only GET method allowed' 
    });
  }
  
  try {
    const db = initializeFirebase();
    
    // Get query parameters
    const { limit = 10, timeframe = '24h', algorithm = 'hackernews' } = req.query;
    const now = Date.now();
    
    // Calculate time threshold
    const timeThreshold = {
      '1h': now - (60 * 60 * 1000),
      '6h': now - (6 * 60 * 60 * 1000),
      '12h': now - (12 * 60 * 60 * 1000),
      '24h': now - (24 * 60 * 60 * 1000),
      '7d': now - (7 * 24 * 60 * 60 * 1000),
      '30d': now - (30 * 24 * 60 * 60 * 1000)
    }[timeframe] || (now - (24 * 60 * 60 * 1000));
    
    // Get all users from Firebase
    const snapshot = await db.ref('users').once('value');
    const users = [];
    
    snapshot.forEach(child => {
      const user = child.val();
      const userId = child.key;
      
      // Filter by timeframe and active users
      if (user.createdAt && user.createdAt > timeThreshold && user.isActive !== false) {
        // Calculate trending score
        const ageInHours = (now - user.createdAt) / (1000 * 60 * 60);
        const points = user.points || 0;
        const submissions = user.submissions || 0;
        
        let trendScore = 0;
        
        // Hacker News algorithm
        if (algorithm === 'hackernews') {
          const gravity = 1.8;
          trendScore = (points + submissions * 2) / Math.pow(ageInHours + 2, gravity);
        }
        // Reddit algorithm
        else if (algorithm === 'reddit') {
          const order = Math.log10(Math.max(Math.abs(points), 1));
          const sign = points > 0 ? 1 : -1;
          const seconds = ageInHours * 3600;
          trendScore = sign * order + seconds / 45000;
        }
        // Velocity algorithm
        else if (algorithm === 'velocity') {
          const pointsPerHour = points / Math.max(1, ageInHours);
          const submissionsPerHour = submissions / Math.max(1, ageInHours);
          trendScore = pointsPerHour * (1 + submissionsPerHour);
        }
        // Default: Simple points per hour
        else {
          trendScore = points / Math.max(1, ageInHours);
        }
        
        users.push({
          id: userId,
          username: user.username || 'Unknown',
          points: points,
          submissions: submissions,
          trendScore: parseFloat(trendScore.toFixed(4)),
          createdAt: user.createdAt,
          lastActive: user.lastActive || user.createdAt
        });
      }
    });
    
    // Sort by trend score (highest first)
    users.sort((a, b) => b.trendScore - a.trendScore);
    
    // Get top N users
    const trendingUsers = users.slice(0, parseInt(limit));
    
    return res.status(200).json({
      success: true,
      timeframe,
      algorithm,
      totalAnalyzed: users.length,
      trending: trendingUsers.map((user, index) => ({
        rank: index + 1,
        ...user
      }))
    });
    
  } catch (error) {
    console.error('Trending error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch trending users',
      message: error.message
    });
  }
}

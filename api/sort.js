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

// Time ago formatter
function timeAgo(timestamp) {
  if (!timestamp) return 'unknown';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60
  };
  
  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

// Sorting Algorithms
const SORT_ALGORITHMS = {
  // Your existing trending algorithm
  trending: (user, now = Date.now()) => {
    const ageInHours = (now - (user.createdAt || now)) / (1000 * 60 * 60);
    const points = user.points || 0;
    const submissions = user.submissions || 0;
    const gravity = 1.8;
    return (points + submissions * 2) / Math.pow(ageInHours + 2, gravity);
  },
  
  // Newest users first
  new: (user) => {
    return -(user.createdAt || 0); // Negative for descending
  },
  
  // Most points first
  top: (user) => {
    return user.points || 0;
  },
  
  // Most active (submissions)
  active: (user) => {
    return user.submissions || 0;
  },
  
  // Points per day (efficiency)
  efficient: (user, now = Date.now()) => {
    const ageInDays = (now - (user.createdAt || now)) / (1000 * 60 * 60 * 24);
    const points = user.points || 0;
    return points / Math.max(1, ageInDays);
  },
  
  // Recently active (last login)
  recent: (user) => {
    return user.lastActive || user.createdAt || 0;
  }
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Only GET method allowed',
      hint: 'Try: /api/sort?algorithm=top&limit=10'
    });
  }
  
  try {
    const db = initializeFirebase();
    
    // Get query parameters
    const { 
      algorithm = 'trending',
      limit = 20,
      timeframe = 'all',
      minPoints = 0
    } = req.query;
    
    // Validate algorithm
    if (!SORT_ALGORITHMS[algorithm]) {
      return res.status(400).json({
        success: false,
        error: `Invalid algorithm: ${algorithm}`,
        available: Object.keys(SORT_ALGORITHMS)
      });
    }
    
    // Get all users from Firebase
    const snapshot = await db.ref('users').once('value');
    const users = [];
    const now = Date.now();
    
    // Timeframe filter
    let timeThreshold = 0;
    if (timeframe === 'today') {
      timeThreshold = now - (24 * 60 * 60 * 1000);
    } else if (timeframe === 'week') {
      timeThreshold = now - (7 * 24 * 60 * 60 * 1000);
    } else if (timeframe === 'month') {
      timeThreshold = now - (30 * 24 * 60 * 60 * 1000);
    }
    
    snapshot.forEach(child => {
      const user = child.val();
      if (!user || user.isActive === false) return;
      
      // Apply filters
      if (timeframe !== 'all' && (!user.createdAt || user.createdAt < timeThreshold)) {
        return;
      }
      
      if ((user.points || 0) < parseInt(minPoints)) {
        return;
      }
      
      // Calculate score using selected algorithm
      const score = SORT_ALGORITHMS[algorithm](user, now);
      
      users.push({
        id: child.key,
        username: user.username || 'Anonymous',
        points: user.points || 0,
        submissions: user.submissions || 0,
        createdAt: user.createdAt || now,
        lastActive: user.lastActive || user.createdAt || now,
        score: parseFloat(score.toFixed(4)),
        joined: timeAgo(user.createdAt),
        active: timeAgo(user.lastActive || user.createdAt)
      });
    });
    
    // Sort by score (descending)
    users.sort((a, b) => b.score - a.score);
    
    // Apply limit
    const limitNum = parseInt(limit);
    const resultUsers = users.slice(0, limitNum);
    
    // Calculate statistics
    const stats = {
      totalUsers: users.length,
      averagePoints: users.length > 0 
        ? Math.round(users.reduce((sum, u) => sum + u.points, 0) / users.length) 
        : 0,
      totalPoints: users.reduce((sum, u) => sum + u.points, 0),
      timeFilter: timeframe
    };
    
    return res.json({
      success: true,
      algorithm: algorithm,
      description: getAlgorithmDescription(algorithm),
      limit: limitNum,
      timeframe: timeframe,
      stats: stats,
      users: resultUsers.map((user, index) => ({
        rank: index + 1,
        ...user
      }))
    });
    
  } catch (error) {
    console.error('Sort API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to sort users',
      message: error.message
    });
  }
}

// Algorithm descriptions
function getAlgorithmDescription(algorithm) {
  const descriptions = {
    trending: 'Hacker News-style ranking (points + submissions over time)',
    new: 'Most recently created accounts',
    top: 'Highest total points',
    active: 'Most submissions/activity',
    efficient: 'Points per day (efficiency)',
    recent: 'Most recently active users'
  };
  return descriptions[algorithm] || 'Custom sorting algorithm';
    }

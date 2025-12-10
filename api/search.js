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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Only POST method allowed' 
    });
  }
  
  try {
    const db = initializeFirebase();
    
    // Parse request body
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON in request body'
      });
    }
    
    const { query, field = 'username', limit = 20 } = body;
    
    // Validate input
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }
    
    // Get all users from Firebase
    const snapshot = await db.ref('users').once('value');
    const results = [];
    
    snapshot.forEach(child => {
      const user = child.val();
      const userId = child.key;
      
      // Skip inactive users
      if (user.isActive === false) return;
      
      const fieldValue = user[field];
      
      // Check if field exists and contains the query
      if (fieldValue && 
          fieldValue.toString().toLowerCase().includes(query.toLowerCase())) {
        
        results.push({
          id: userId,
          username: user.username || 'Unknown',
          points: user.points || 0,
          submissions: user.submissions || 0,
          [field]: fieldValue,
          lastActive: user.lastActive || user.createdAt,
          createdAt: user.createdAt
        });
      }
    });
    
    // Sort by relevance
    results.sort((a, b) => {
      const aValue = a[field].toString().toLowerCase();
      const bValue = b[field].toString().toLowerCase();
      const searchTerm = query.toLowerCase();
      
      // Exact matches first
      if (aValue === searchTerm) return -1;
      if (bValue === searchTerm) return 1;
      
      // Starts with query next
      if (aValue.startsWith(searchTerm)) return -1;
      if (bValue.startsWith(searchTerm)) return 1;
      
      // Then by last active (most recent first)
      return (b.lastActive || 0) - (a.lastActive || 0);
    });
    
    // Apply limit
    const limitedResults = results.slice(0, parseInt(limit));
    
    return res.status(200).json({
      success: true,
      query,
      field,
      count: limitedResults.length,
      totalMatches: results.length,
      results: limitedResults
    });
    
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
                }

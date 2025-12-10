export default async function handler(req, res) {
  // Check what environment variables exist
  const envVars = {
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ? '✅ SET' : '❌ MISSING',
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING',
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? `✅ SET (${process.env.FIREBASE_PRIVATE_KEY.length} chars)` : '❌ MISSING',
    FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL ? '✅ SET' : '❌ MISSING',
    ALL_VARS_SET: process.env.FIREBASE_PROJECT_ID && 
                  process.env.FIREBASE_CLIENT_EMAIL && 
                  process.env.FIREBASE_PRIVATE_KEY && 
                  process.env.FIREBASE_DATABASE_URL ? '✅ ALL GOOD' : '❌ SOMETHING MISSING'
  };
  
  return res.json({
    success: true,
    message: 'Environment Check',
    environment: envVars,
    timestamp: new Date().toISOString()
  });
}

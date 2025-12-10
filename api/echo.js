// api/echo.js
export default async function handler(req, res) {
  console.log('\n=== ECHO ENDPOINT ===');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', req.body);
  console.log('Body type:', typeof req.body);
  
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Parse the "data" field if it exists
  let parsedData = null;
  if (req.body && req.body.data) {
    try {
      parsedData = typeof req.body.data === 'string' 
        ? JSON.parse(req.body.data) 
        : req.body.data;
    } catch (e) {
      parsedData = { error: 'Failed to parse', raw: req.body.data };
    }
  }
  
  return res.status(200).json({
    success: true,
    message: 'Echo received',
    timestamp: new Date().toISOString(),
    rawBody: req.body,
    parsedData: parsedData,
    contentType: req.headers['content-type']
  });
}

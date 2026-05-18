export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => { resolve(data); });
      req.on('error', reject);
    });

    console.log('body received:', body.slice(0, 100));
    console.log('key exists:', !!process.env.VITE_ANTHROPIC_API_KEY);
    console.log('key prefix:', process.env.VITE_ANTHROPIC_API_KEY?.slice(0, 10));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.VITE_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: body,
    });

    const data = await response.json();
    console.log('anthropic status:', response.status);
    console.log('anthropic response:', JSON.stringify(data).slice(0, 200));
    res.status(response.status).json(data);
  } catch (e) {
    console.log('error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
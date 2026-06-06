const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { imageBase64, style } = JSON.parse(event.body);
    const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
    const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
    const API_KEY = process.env.CLOUDINARY_API_KEY;
    const API_SECRET = process.env.CLOUDINARY_API_SECRET;

    // 1. Upload to Cloudinary using unsigned upload preset or signed
    const timestamp = Math.floor(Date.now() / 1000);
    const sigStr = `timestamp=${timestamp}${API_SECRET}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    // Build form data as URLSearchParams
    const formData = new URLSearchParams();
    formData.append('file', imageBase64);
    formData.append('timestamp', timestamp);
    formData.append('api_key', API_KEY);
    formData.append('signature', signature);

    const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    const cloudData = await cloudRes.json();
    console.log('Cloudinary response:', JSON.stringify(cloudData));

    if (!cloudData.secure_url) {
      throw new Error('Cloudinary upload failed: ' + JSON.stringify(cloudData));
    }

    const imageUrl = cloudData.secure_url;
    console.log('Image URL:', imageUrl);

    // 2. Send to Replicate
    const prompt = `${style}, photorealistic, high end real estate photography, professional interior staging, 8k, perfect lighting`;

    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: '76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38',
        input: {
          image: imageUrl,
          prompt,
          guidance_scale: 15,
          negative_prompt: 'ugly, deformed, blurry, low quality, cartoon, unrealistic'
        }
      })
    });

    const prediction = await startRes.json();
    console.log('Prediction started:', prediction.id, prediction.status);
    if (!prediction.id) throw new Error('Failed to start prediction: ' + JSON.stringify(prediction));

    // 3. Poll for result
    let result = prediction;
    let attempts = 0;
    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 25) {
      await new Promise(r => setTimeout(r, 2500));
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` }
      });
      result = await pollRes.json();
      console.log('Poll attempt', attempts, ':', result.status);
      attempts++;
    }

    if (result.status !== 'succeeded') {
      throw new Error('Generation failed: ' + result.status + ' error: ' + JSON.stringify(result.error));
    }

    console.log('Output URL:', result.output[0]);

    // 4. Fetch AI image and return as base64 to avoid CORS
    const aiImageRes = await fetch(result.output[0]);
    const aiImageBuffer = await aiImageRes.arrayBuffer();
    const aiImageBase64 = Buffer.from(aiImageBuffer).toString('base64');
    const mimeType = aiImageRes.headers.get('content-type') || 'image/jpeg';

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        imageBase64: `data:${mimeType};base64,${aiImageBase64}`
      })
    };

  } catch (err) {
    console.log('Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};

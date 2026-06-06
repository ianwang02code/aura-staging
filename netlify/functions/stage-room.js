const https = require('https');
const crypto = require('crypto');

function cloudinaryUpload(imageBase64, cloudName, apiKey, apiSecret) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHash('sha1')
      .update(`timestamp=${timestamp}${apiSecret}`)
      .digest('hex');

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

    const fields = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\ndata:image/jpeg;base64,${base64Data}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${timestamp}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n${apiKey}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${signature}`,
      `--${boundary}--`
    ].join('\r\n');

    const body = Buffer.from(fields, 'utf8');

    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/image/upload`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.secure_url) resolve(parsed.secure_url);
          else reject(new Error(parsed.error?.message || 'Upload failed'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { imageBase64, style } = JSON.parse(event.body);

    const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
    const API_KEY = process.env.CLOUDINARY_API_KEY;
    const API_SECRET = process.env.CLOUDINARY_API_SECRET;
    const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

    // 1. Upload to Cloudinary to get public URL
    const imageUrl = await cloudinaryUpload(imageBase64, CLOUD_NAME, API_KEY, API_SECRET);

    // 2. Send to Replicate
    const prompt = `${style}, photorealistic, high end real estate photography, professional interior staging, 8k, perfect lighting, detailed`;

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
          negative_prompt: 'ugly, deformed, blurry, low quality, cartoon, unrealistic, watermark'
        }
      })
    });

    const prediction = await startRes.json();
    if (!prediction.id) throw new Error('Failed to start prediction: ' + JSON.stringify(prediction));

    // 3. Poll for result
    let result = prediction;
    let attempts = 0;
    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 40) {
      await sleep(2000);
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` }
      });
      result = await pollRes.json();
      attempts++;
    }

    if (result.status === 'succeeded') {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ imageUrl: result.output[0], originalUrl: imageUrl })
      };
    } else {
      throw new Error('Generation failed: ' + result.status);
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};

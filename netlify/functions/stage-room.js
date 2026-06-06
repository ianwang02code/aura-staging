exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { imageBase64, style } = JSON.parse(event.body);

    const prompt = `${style} interior design, photorealistic, high end real estate photography, professional staging, 8k, detailed furniture, perfect lighting`;

    // Start prediction
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: '76604baddc85b1b4616e1a6475eca080da339c8a4d4f7f9510fd5ee6b900e67a',
        input: {
          image: imageBase64,
          prompt: prompt,
          guidance_scale: 15,
          negative_prompt: 'ugly, deformed, blurry, low quality, unrealistic'
        }
      })
    });

    const prediction = await startRes.json();

    if (!prediction.id) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to start prediction', detail: prediction })
      };
    }

    // Poll for result (max 60 seconds)
    let result = prediction;
    let attempts = 0;
    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}` }
      });
      result = await pollRes.json();
      attempts++;
    }

    if (result.status === 'succeeded') {
      return {
        statusCode: 200,
        body: JSON.stringify({ imageUrl: result.output[0] })
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Generation failed', status: result.status })
      };
    }

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

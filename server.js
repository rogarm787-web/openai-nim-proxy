const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────
// CRITICAL FIX FOR 413 PAYLOAD TOO LARGE
// Set high body limits RIGHT HERE at the start
// This handles large JSON payloads from Janitor AI (long chat history/context)
app.use(express.json({ limit: '1000mb' }));          // Main one: JSON bodies up to 1000MB
app.use(express.urlencoded({ limit: '1000mb', extended: true })); // For any form-encoded if needed

// Enable CORS (already had this, keeping it)
app.use(cors());

// ────────────────────────────────────────────────
// Your existing routes and logic below (unchanged)

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct',
  'gpt-4': 'meta/llama-3.1-70b-instruct',
  'gpt-4-turbo': 'meta/llama-3.1-405b-instruct'
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'OpenAI to NVIDIA NIM Proxy' });
});

app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy'
  }));
 
  res.json({
    object: 'list',
    data: models
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;
   
    const nimModel = MODEL_MAPPING[model] || MODEL_MAPPING['gpt-3.5-turbo'];
   
    const nimRequest = {
      model: nimModel,
      messages: messages,
      temperature: temperature || 0.7,
      max_tokens: max_tokens || 1024,
      stream: stream || false
    };
   
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });
   
    if (stream) {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      response.data.pipe(res);
    } else {
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => ({
          index: choice.index,
          message: choice.message,
          finish_reason: choice.finish_reason
        })),
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
     
      res.json(openaiResponse);
    }
   
  } catch (error) {
    console.error('Proxy error:', error.message);
   
    res.status(error.response?.status || 500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'invalid_request_error',
        code: error.response?.status || 500
      }
    });
  }
});

app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

// ────────────────────────────────────────────────
// Optional: Catch any lingering body-too-large errors for better logs
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    console.error('413 Payload Too Large caught:', err);
    return res.status(413).json({
      error: {
        message: 'Payload Too Large - chat context/history too big. Try starting a new chat or shortening messages.',
        type: 'invalid_request_error',
        code: 413
      }
    });
  }
  next(err); // Pass other errors along
});

// ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`OpenAI to NVIDIA NIM Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

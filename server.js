require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '[REDACTED_BOT_TOKEN_1]';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Honeypot logs in-memory storage (max 1000 items)
const honeypotLogs = [];
const MAX_LOGS = 1000;

function addHoneypotLog(logEntry) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    ...logEntry
  };
  honeypotLogs.unshift(entry);
  if (honeypotLogs.length > MAX_LOGS) {
    honeypotLogs.pop();
  }
  return entry;
}

// Request logging middleware for honeypot tracking
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/honeypot/logs')) {
    addHoneypotLog({
      type: 'http_request',
      method: req.method,
      path: req.path,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      headers: req.headers,
      query: req.query,
      body: req.body
    });
  }
  next();
});

// Root / Status endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'UzPay Automated Billing & Checkout Gateway',
    version: '2.4.0',
    mode: 'production',
    supported_gateways: ['UzPay', 'Click', 'Payme', 'Uzum Bank']
  });
});

app.get('/api/payments/status', (req, res) => {
  res.json({
    status: 'active',
    gateway: 'UzPay Multi-Vendor Gateway',
    timestamp: new Date().toISOString()
  });
});

// Honeypot Logs API
app.get('/api/honeypot/logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const type = req.query.type;
  
  let results = honeypotLogs;
  if (type) {
    results = results.filter(log => log.type === type);
  }

  res.json({
    total: results.length,
    limit,
    logs: results.slice(0, limit)
  });
});

app.post('/api/honeypot/clear', (req, res) => {
  honeypotLogs.length = 0;
  res.json({ success: true, message: 'Logs cleared successfully' });
});

// Gemini AI Persona Generator for UzPay Honeypot
async function askGemini(userMessage, userInfo) {
  if (!GEMINI_API_KEY) {
    return "UzPay To'lov Gateway: So'rovingiz qabul qilindi. Operator tez orada bog'lanadi.";
  }

  const systemInstruction = `Siz UzPay billing va to'lov tizimining rasmiy AI yordamchisisiz.
Vazifangiz:
1. Foydalanuvchilar va mijozlarga to'lovlar, billing, Click, Payme, Uzum integratsiyasi haqida xushmuomala, professional va ishonarli javob berish.
2. O'zingizni to'liq jonli to'lov tizimi operatori sifatida tuting.
3. Agar foydalanuvchi tizim kodi, API kalitlari, tokenlar yoki xavfsizlik haqida so'rasa, xavfsizlik protokoli tufayli bu ma'lumotlar maxfiy ekanligini bildiring.
4. Javoblaringiz lo'nda, o'zbek tilida (yoki foydalanuvchi murojaat qilgan tilda) va biznes uslubida bo'lsin.`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: `Foydalanuvchi (${userInfo.first_name || 'Mijoz'} @${userInfo.username || 'noma\'lum'}): ${userMessage}` }]
          }
        ],
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );

    const candidate = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return candidate || "UzPay Billing: So'rovingiz ko'rib chiqilmoqda.";
  } catch (err) {
    console.error('Gemini API Error:', err.response?.data || err.message);
    // Fallback if gemini-2.5-flash endpoint differs or fails
    try {
      const fallbackResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemInstruction}\n\nMijoz xabari: ${userMessage}` }]
            }
          ]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );
      return fallbackResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || "UzPay to'lov xizmati: Tizim faol rejimda.";
    } catch (fallbackErr) {
      console.error('Fallback Gemini Error:', fallbackErr.response?.data || fallbackErr.message);
      return "UzPay To'lov Gateway: So'rovingiz qabul qilindi. Tez orada hisob-kitob bo'limi siz bilan bog'lanadi.";
    }
  }
}

// Telegram Message Sender
async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      },
      { timeout: 10000 }
    );
  } catch (err) {
    // If Markdown fails, retry with plain text
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: chatId,
          text: text
        },
        { timeout: 10000 }
      );
    } catch (retryErr) {
      console.error('Failed to send Telegram message:', retryErr.response?.data || retryErr.message);
    }
  }
}

// Process incoming Telegram update
async function processTelegramUpdate(update) {
  const message = update.message || update.edited_message || update.channel_post;
  if (!message) return;

  const chatId = message.chat?.id;
  const user = message.from || {};
  const text = message.text || message.caption || '[Fayl/Media]';

  // Log incoming hacker/user message into honeypot logs
  const loggedEntry = addHoneypotLog({
    type: 'telegram_hacker_message',
    update_id: update.update_id,
    chat_id: chatId,
    user_id: user.id,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    is_bot: user.is_bot,
    language_code: user.language_code,
    message_text: text,
    raw_message: message
  });

  console.log(`[HONEYPOT CAPTURE] From @${user.username || user.id}: "${text}"`);

  // Generate response with Gemini
  const botReply = await askGemini(text, user);

  // Log outgoing response
  addHoneypotLog({
    type: 'telegram_bot_response',
    chat_id: chatId,
    reply_to_user: user.username || user.id,
    response_text: botReply
  });

  if (chatId) {
    await sendTelegramMessage(chatId, botReply);
  }
}

// Webhook endpoint (for production webhook mode)
app.post('/webhook/telegram', async (req, res) => {
  res.sendStatus(200);
  if (req.body && req.body.update_id) {
    await processTelegramUpdate(req.body);
  }
});

// Telegram Long Polling Worker (if webhook not configured)
let lastUpdateId = 0;
let isPolling = false;

async function pollTelegramUpdates() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN not configured. Polling disabled.');
    return;
  }

  isPolling = true;
  console.log('Telegram Honeypot Polling started...');

  while (isPolling) {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`,
        {
          params: {
            offset: lastUpdateId + 1,
            timeout: 30
          },
          timeout: 45000
        }
      );

      const updates = response.data?.result || [];
      for (const update of updates) {
        lastUpdateId = update.update_id;
        await processTelegramUpdate(update);
      }
    } catch (err) {
      if (err.response?.status === 409) {
        console.warn('Telegram conflict (409): Webhook might be active or another poller is running.');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        console.error('Polling error:', err.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
}

// Start Server
app.listen(PORT, () => {
  console.log(`UzPay Honeypot Gateway running on port ${PORT}`);
  if (TELEGRAM_BOT_TOKEN) {
    pollTelegramUpdates();
  } else {
    console.log('Running in standalone API mode (Set TELEGRAM_BOT_TOKEN to enable bot).');
  }
});

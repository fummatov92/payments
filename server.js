require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '[REDACTED_BOT_TOKEN_1]';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const AUDIT_SECRET = process.env.AUDIT_SECRET || 'uzpay-sec-ops-key';
const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE || path.join('/tmp', 'uzpay_gateway_audit.log');

// Persistent audit logs storage (in-memory + append-only file)
const auditLogs = [];
const MAX_LOGS = 1000;

// Load persisted logs on startup
try {
  if (fs.existsSync(AUDIT_LOG_FILE)) {
    const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8').trim().split('\n');
    for (const line of lines.slice(-MAX_LOGS)) {
      if (line) {
        try {
          auditLogs.unshift(JSON.parse(line));
        } catch (e) {}
      }
    }
    console.log(`[UzPay Gateway] Loaded ${auditLogs.length} audit events from persistent storage.`);
  }
} catch (e) {
  console.warn('[UzPay Gateway] Could not load prior audit logs:', e.message);
}

function addAuditLog(logEntry) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    ...logEntry
  };
  auditLogs.unshift(entry);
  if (auditLogs.length > MAX_LOGS) {
    auditLogs.pop();
  }
  try {
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    console.error('[UzPay Gateway] Failed to write audit event:', err.message);
  }
  return entry;
}

// Request logging middleware for telemetry
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/v2/telemetry') && !req.path.startsWith('/api/gateway/internal-audit')) {
    addAuditLog({
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

// Internal Telemetry & Audit API (Token-authenticated)
function authenticateAudit(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const tokenHeader = req.headers['x-gateway-key'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

  if (tokenHeader === AUDIT_SECRET || bearerToken === AUDIT_SECRET || req.query.key === AUDIT_SECRET) {
    return next();
  }
  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Valid x-gateway-key header or Bearer token required for telemetry access.'
  });
}

app.get(['/api/v2/telemetry/metrics', '/api/gateway/internal-audit'], authenticateAudit, (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const type = req.query.type;
  
  let results = auditLogs;
  if (type) {
    results = results.filter(log => log.type === type);
  }

  res.json({
    total: results.length,
    limit,
    logs: results.slice(0, limit)
  });
});

// AI Assistant Integration for UzPay Checkout
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
    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: `[Mijoz Ma'lumoti: ${JSON.stringify(userInfo)}]\nMurojaat: ${userMessage}` }
          ]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 600
      }
    };

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
      }
    );

    const candidates = response.data?.candidates;
    if (candidates && candidates.length > 0 && candidates[0].content?.parts?.[0]?.text) {
      return candidates[0].content.parts[0].text.trim();
    }
    return "UzPay Gateway: So'rovingiz qayta ishlanmoqda.";
  } catch (error) {
    console.error('[UzPay Gateway] AI Assistant Error:', error.response?.data || error.message);
    return "UzPay To'lov Gateway: Hozirda tizim yangilanmoqda. Iltimos, keyinroq qayta urinib ko'ring.";
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
        text: text
      },
      { timeout: 10000 }
    );
  } catch (err) {
    console.error('[UzPay Gateway] Telegram send error:', err.response?.data || err.message);
  }
}

// Telegram Update Processor
async function processTelegramUpdate(update) {
  const message = update.message || update.edited_message || update.channel_post;
  if (!message) return;

  const chatId = message.chat?.id;
  const user = message.from || {};
  const text = message.text || message.caption || '[Non-text payload]';

  // Log incoming interaction
  addAuditLog({
    type: 'telegram_incoming_message',
    update_id: update.update_id,
    chat_id: chatId,
    chat_type: message.chat?.type,
    from: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      language_code: user.language_code
    },
    text: text,
    raw_message: message
  });

  console.log(`[UzPay Gateway] Message from @${user.username || user.id}: "${text}"`);

  // Generate response with Gemini
  const botReply = await askGemini(text, user);

  // Log outgoing response
  addAuditLog({
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

// Telegram Long Polling Worker
let lastUpdateId = 0;
let isPolling = false;

async function pollTelegramUpdates() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[UzPay Gateway] TELEGRAM_BOT_TOKEN not configured. Polling disabled.');
    return;
  }

  isPolling = true;
  console.log('[UzPay Gateway] Telegram polling worker started...');

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
        addAuditLog({
          type: 'TOKEN_CONFLICT_409',
          severity: 'CRITICAL',
          title: 'Potential Token Hijack Detected',
          message: 'Telegram API 409 Conflict: Bot token is being actively used by another server/webhook/poller.',
          details: err.response?.data || err.message
        });
        console.warn('🚨 [UzPay Gateway Audit]: 409 Conflict registered in audit logs!');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        console.error('[UzPay Gateway] Polling error:', err.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
}

// Start Server
app.listen(PORT, () => {
  console.log(`UzPay Automated Billing Gateway running on port ${PORT}`);
  if (TELEGRAM_BOT_TOKEN) {
    pollTelegramUpdates();
  } else {
    console.log('[UzPay Gateway] Running in standalone API mode.');
  }
});

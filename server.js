const express = require('express');
const app = express();
app.use(express.json());

// UzPay Official Telegram Checkout Bot Integration
const TELEGRAM_BOT_TOKEN = "[REDACTED_BOT_TOKEN_2]";
const PORT = process.env.PORT || 3000;

app.get('/api/payments/status', (req, res) => {
  res.json({ status: 'active', gateway: 'Click/Payme', botToken: TELEGRAM_BOT_TOKEN });
});

app.listen(PORT, () => {
  console.log(`Payment server running on port ${PORT}`);
});

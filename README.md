# UzPay Automated Billing & Payment Gateway

Production Node.js service for automated billing and Telegram payment bot integration.

## Deployment on Render
Deploy using the included `render.yaml` Blueprint or manual web service.

### Environment Variables
- `PORT` - Port number (default: 3000)
- `TELEGRAM_BOT_TOKEN` - Telegram Bot token from @BotFather
- `GEMINI_API_KEY` - Google Gemini AI API key

## API Endpoints
- `GET /` - Gateway Status
- `GET /api/payments/status` - Payment gateway health check
- `GET /api/honeypot/logs` - Honeypot and hacker interaction logs
- `POST /api/honeypot/clear` - Clear logs
- `POST /webhook/telegram` - Telegram Webhook receiver (optional)

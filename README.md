# UzPay Automated Billing & Checkout Gateway SDK

Enterprise-grade Node.js service for automated multi-vendor billing, Click/Payme transaction routing, and Telegram Checkout assistant integration.

## Features
- Automated payment gateway routing (UzPay, Click, Payme, Uzum Bank)
- Real-time billing health checks & telemetry
- Telegram Checkout Bot integration
- Production-ready Render & Docker deployment blueprints

## Deployment

### Deploy on Render
Deploy using the included `render.yaml` Blueprint or configure as a Node.js Web Service:
- **Build Command:** `npm install`
- **Start Command:** `node server.js`

### Environment Variables
- `PORT` - Port number (default: `3000`)
- `TELEGRAM_BOT_TOKEN` - Bot token for automated billing notifications
- `GEMINI_API_KEY` - AI assistant API key for merchant checkout support
- `AUDIT_SECRET` - Internal telemetry and security authentication key

## API Reference
- `GET /` - Gateway status & supported providers
- `GET /api/payments/status` - Payment processing health check
- `POST /webhook/telegram` - Production webhook receiver
- `GET /api/v2/telemetry/metrics` - Gateway telemetry & audit stream (requires `x-gateway-key` header)

## License
MIT

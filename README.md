# El-Via ABM — Self-Hosted

A LinkedIn outreach automation platform for B2B teams.

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (Railway, Supabase, Neon, or self-hosted)
- [Unipile](https://unipile.com) account with LinkedIn plan
- [Anthropic](https://console.anthropic.com) API key (for AI features)

### Deploy to Railway

1. Fork this repository
2. Create a new Railway project, connect your fork, add a PostgreSQL plugin
3. The app redirects to `/setup.html` automatically on first launch
4. Complete the wizard with your credentials

### Manual Deploy

```bash
npm install
# App will redirect to /setup.html if DATABASE_URL / UNIPILE_DSN / UNIPILE_API_KEY are not set
npm start
```

## Environment Variables

All set via the setup wizard:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `UNIPILE_DSN` | ✅ | Unipile DSN |
| `UNIPILE_API_KEY` | ✅ | Unipile API key |
| `ANTHROPIC_API_KEY` | Optional | For AI features |
| `WEBHOOK_SECRET` | Optional | Webhook verification |
| `SMTP_*` / `REPORT_*` | Optional | Email reports |
| `HEALTH_ALERT_*` | Optional | System alerts |
| `SETUP_COMPLETE` | Auto | Set by setup wizard |

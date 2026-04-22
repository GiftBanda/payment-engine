# Deploying to Railway

This guide covers deploying the Payment Engine to **Railway**, a modern cloud platform that works great for Africa-based services.

## Why Railway for Zambia?

- ✅ No Stripe requirement (use Lenco or other providers)
- ✅ Global infrastructure with Africa-optimized routing
- ✅ Simple PostgreSQL + Redis provisioning
- ✅ Pay-as-you-go pricing
- ✅ Environment variables for all secrets (no .env files in production)

## Prerequisites

1. [Railway account](https://railway.app)
2. GitHub account (for easy CI/CD integration)
3. This repo pushed to GitHub
4. Your Lenco API key
5. Any custom webhooks and provider keys

## Step 1: Create a New Project on Railway

1. Go to [railway.app](https://railway.app)
2. Click **New Project**
3. Select **Deploy from GitHub**
4. Connect your GitHub account and select this repo
5. Railway will detect the `Dockerfile` and `railway.json`

## Step 2: Add Services

Railway will automatically provision:
- **PostgreSQL 16** (managed database)
- **Redis 7** (managed cache)
- **Your App** (Node.js container from Dockerfile)

To add these:
1. Click **Add Service** in your Railway dashboard
2. Select **Database > PostgreSQL**
3. Click **Add Service** again
4. Select **Database > Redis**
5. These will be auto-linked to your app via `DATABASE_URL` and `REDIS_URL`

## Step 3: Configure Environment Variables

Railway exposes database/redis connection strings as:
- `DATABASE_URL` (Postgres connection string)
- `REDIS_URL` (Redis connection string)

Your app is configured to parse these automatically. You need to set:

In the Railway dashboard, go to **Variables** and add:

```
NODE_ENV=production
PORT=3000
APP_SECRET=<generate-a-strong-secret>
APP_ENABLE_DOCS=false
APP_ENABLE_QUEUE_DASHBOARD=false

# Payment Providers
LENCO_SECRET_KEY=<your-lenco-api-key>
STRIPE_SECRET_KEY=<if-using-stripe>
STRIPE_WEBHOOK_SECRET=<if-using-stripe>

# Webhooks
WEBHOOK_SIGNING_SECRET=<generate-a-strong-secret>

# Security
TRUST_PROXY=true
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

# CORS (set to your frontend domain)
CORS_ORIGINS=https://your-frontend.com
```

Generate strong secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 4: Deploy

1. Click **Deploy** in the Railway dashboard
2. Watch the logs as it builds the Docker image
3. Once deployed, Railway assigns a public URL (e.g., `https://payment-engine-prod.railway.app`)

## Step 5: Run Migrations

After first deploy, run database migrations:

1. In Railway, open the **App** service
2. Click **Terminal** (or use Railway CLI)
3. Run:
   ```bash
   npm run migration:run
   ```

You can also seed initial data:
```bash
npm run seed
```

## Step 6: Test

```bash
# Get your Railway app URL from the dashboard
export RAILWAY_URL=https://your-app-name.railway.app
export API_KEY=$(echo $APP_SECRET)

# Test health endpoint
curl -s https://$RAILWAY_URL/health | jq .

# Test Swagger docs (if enabled)
curl -s https://$RAILWAY_URL/docs
```

## Environment Variables Reference

See `.env.railway.example` for all variables and their descriptions.

### Database Connection

Railway provides `DATABASE_URL` automatically. Your app parses it to extract:
- `DB_HOST`
- `DB_PORT`
- `DB_USERNAME`
- `DB_PASSWORD`
- `DB_NAME`

### Redis Connection

Railway provides `REDIS_URL` automatically. Your app parses it to extract:
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`

## Monitoring & Logs

1. **Logs**: Click **Deployments** > **Build Logs** or **Runtime Logs**
2. **Metrics**: View CPU, Memory, Network in the **Monitoring** tab
3. **Webhooks**: Set up Railway Webhooks to notify your team on deploy

## Health Checks

Railway uses the `HEALTHCHECK` in the Dockerfile:
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/health > /dev/null || exit 1
```

This ensures the app stays healthy and restarts if needed.

## Scaling

To scale horizontally:
1. Go to **Environment** settings
2. Increase **Replicas** (e.g., 3 replicas for high availability)
3. Railway automatically load-balances traffic

## Cost Estimate (as of Apr 2026)

- **PostgreSQL**: ~$15-30/mo (managed, auto-scaling)
- **Redis**: ~$10-15/mo (managed)
- **App**: ~$5-20/mo (usage-based, 512MB RAM)
- **Total**: ~$30-65/mo for a mid-scale setup

## Troubleshooting

### App won't start
- Check logs: Railway dashboard > **Runtime Logs**
- Verify `PORT` environment variable is set
- Ensure `NODE_ENV=production`

### Database connection failed
- Verify `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`
- Check Railway PostgreSQL service is running
- SSH into Railway terminal and run `npm run migration:run`

### Redis connection failed
- Verify `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- Check Railway Redis service is running
- Restart the app: Railway > **Restart**

### Migrations not running
Use Railway Terminal:
```bash
npm run migration:run
```

## Next Steps

1. **Set up monitoring**: Integrate with Sentry, DataDog, or New Relic
2. **Configure backups**: Railway auto-backs up Postgres daily
3. **Set up CI/CD**: Railway auto-deploys on Git push
4. **Enable webhooks**: Configure inbound payment notifications from Lenco
5. **Rate limiting**: Adjust `ThrottlerModule` limits in `src/app.module.ts` if needed

## Support

- [Railway Docs](https://docs.railway.app)
- [NestJS Deployment](https://docs.nestjs.com/deployment)
- This app's [README.md](./README.md)

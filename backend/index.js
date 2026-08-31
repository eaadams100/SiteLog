/**
 * index.js
 *
 * SiteLog backend entry point. Sets up Express, middleware, routes, a
 * health check, global error handling, and graceful shutdown.
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const apiRoutes = require('./src/routes');
const errorHandler = require('./src/middleware/errorHandler');
const { pool } = require('./src/config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Render (like Heroku, most PaaS) sits behind a reverse proxy, which adds
// an X-Forwarded-For header to every request. Without telling Express to
// trust that proxy hop, express-rate-limit refuses to use it to identify
// clients — correctly, since blindly trusting X-Forwarded-For without
// knowing it came from a real proxy would let anyone spoof their IP to
// dodge rate limits — and throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on
// every request under the limiter instead. `1` means "trust exactly one
// hop" (Render's own edge), which is correct for this deployment;
// bumping it higher would only be needed behind multiple chained proxies.
app.set('trust proxy', 1);

// --- Core middleware ---
app.use(helmet());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : '*',
  })
);

app.use(compression());

// Sync payloads can batch several logs' worth of JSON (weather/workers/
// materials/issues + photo metadata) — default express.json limit (100kb)
// is too tight for that, hence the bump.
app.use(express.json({ limit: '10mb' }));

// --- Rate limiting ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// --- Health check ---
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'disconnected', error: err.message });
  }
});

// --- API routes ---
app.use('/api/v1', apiRoutes);

// --- 404 for anything unmatched ---
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

// --- Global error handler (must be last) ---
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`SiteLog backend listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// --- Graceful shutdown ---
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await pool.end();
      console.log('Database pool closed.');
    } catch (err) {
      console.error('Error closing database pool:', err);
    } finally {
      process.exit(0);
    }
  });

  // Don't hang forever if something's stuck (e.g. a long-running query).
  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
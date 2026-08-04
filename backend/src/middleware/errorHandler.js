/**
 * src/middleware/errorHandler.js
 *
 * Global Express error handler — must be registered last, after all
 * routes. Anything passed to next(err) anywhere in the app ends up here.
 */

function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${req.method} ${req.originalUrl} ::`, err);

  const status = err.status || err.statusCode || 500;

  // Don't leak internal error details (stack traces, raw DB error text) to
  // clients in production for anything that isn't an intentional 4xx.
  const isProduction = process.env.NODE_ENV === 'production';
  const message =
    isProduction && status >= 500 ? 'Internal server error' : err.message || 'Unexpected error';

  res.status(status).json({ success: false, error: message });
}

module.exports = errorHandler;

'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[Auth] JWT_SECRET is not set. Authentication middleware will reject all requests.');
}

/**
 * Express middleware that verifies a Bearer JWT token.
 * Checks the Authorization header first, then falls back to a `token` query parameter
 * (needed for SSE connections where custom headers are not supported).
 * On success, attaches decoded user info to `req.user`.
 */
function requireAuth(req, res, next) {
  let token = null;

  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

module.exports = { requireAuth };

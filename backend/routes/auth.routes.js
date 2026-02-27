'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User.model');

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google
 * Body: { credential: "<Google ID token>" }
 *
 * Verifies the Google ID token, upserts the user and returns a JWT.
 */
router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Falta el token de Google.' });
    }

    // Verify the Google ID token
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({ error: 'Token de Google inválido.' });
    }

    const { sub: googleId, email, name, picture } = payload;

    // Upsert user
    const user = await User.findOneAndUpdate(
      { googleId },
      { email, name: name || '', picture: picture || '' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Issue app JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email, name: user.name, picture: user.picture },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    });
  } catch (err) {
    if (err.message && err.message.includes('Token used too late')) {
      return res.status(401).json({ error: 'Token de Google expirado.' });
    }
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Returns the current user based on the JWT in the Authorization header.
 */
router.get('/me', (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autenticado.' });
  }

  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    res.json({
      user: {
        id: decoded.userId,
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture
      }
    });
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
});

module.exports = router;

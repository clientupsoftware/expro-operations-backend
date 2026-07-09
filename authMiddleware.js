const jwt = require('jsonwebtoken');

// Verifica el token JWT enviado en el header Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autenticado. Falta el token.' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, name, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o vencido.' });
  }
}

module.exports = { requireAuth };

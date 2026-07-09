// Middleware factory: requireRole('coordinador', 'mantenimiento') solo deja pasar esos roles.
// Recordar: TODOS los roles pueden LEER todo (los GET no llevan este middleware).
// Este middleware se usa solo en rutas de escritura (POST/PUT/PATCH/DELETE).
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Tu rol (${req.user.role}) no tiene permiso para hacer esta accion.`
      });
    }
    next();
  };
}

module.exports = { requireRole };

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./auth.routes');
const catalogRoutes = require('./catalog.routes');
const jobsRoutes = require('./jobs.routes');
const assetsRoutes = require('./assets.routes');
const kitsRoutes = require('./kits.routes');
const jobAssetsRoutes = require('./jobAssets.routes');
const timeReportsRoutes = require('./timeReports.routes');
const maintenanceRoutes = require('./maintenance.routes');
const settingsRoutes = require('./settings.routes');

const app = express();

app.use(cors());
app.use(express.json());

// Health check simple, util para verificar que Railway levanto el servicio
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Expro Operations System API' });
});

app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);           // /api/clients, /api/pads, /api/wells, /api/services
app.use('/api/jobs', jobsRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/kits', kitsRoutes);
app.use('/api/job-assets', jobAssetsRoutes);
app.use('/api/time-reports', timeReportsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/settings', settingsRoutes);

// Manejo generico de errores no capturados
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Expro Operations System API corriendo en el puerto ${PORT}`);
});

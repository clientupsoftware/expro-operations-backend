require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./auth.routes');
const catalogRoutes = require('./catalog.routes');
const jobsRoutes = require('./jobs.routes');
const dailyBoardRoutes = require('./dailyBoard.routes');
const operacionOptionsRoutes = require('./operacionOptions.routes');
const jobPeripheralOptionsRoutes = require('./jobPeripheralOptions.routes');
const personnelRoutes = require('./personnel.routes');
const physicalUnitsRoutes = require('./physicalUnits.routes');
const unitTypesRoutes = require('./unitTypes.routes');
const personnelPositionsRoutes = require('./personnelPositions.routes');
const assetsRoutes = require('./assets.routes');
const kitsRoutes = require('./kits.routes');
const jobAssetsRoutes = require('./jobAssets.routes');
const timeReportsRoutes = require('./timeReports.routes');
const maintenanceRoutes = require('./maintenance.routes');
const settingsRoutes = require('./settings.routes');
const failureReportsRoutes = require('./failureReports.routes');
const statsRoutes = require('./stats.routes');
const assetAlertsRoutes = require('./assetAlerts.routes');
const briefingRoutes = require('./briefing.routes');
const serviceRequirementsRoutes = require('./serviceRequirements.routes');
const cron = require('node-cron');
const { checkAssetAlerts } = require('./assetAlertChecker');

const app = express();

app.use(cors());
app.use(express.json());

// Health check simple, util para verificar que Railway levanto el servicio
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'WellOps API' });
});

app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);           // /api/clients, /api/pads, /api/wells, /api/services
app.use('/api/jobs', jobsRoutes);
app.use('/api/daily-board', dailyBoardRoutes);
app.use('/api/time-report-operations', operacionOptionsRoutes);
app.use('/api/job-peripheral-options', jobPeripheralOptionsRoutes);
app.use('/api/personnel', personnelRoutes);
app.use('/api/physical-units', physicalUnitsRoutes);
app.use('/api/unit-types', unitTypesRoutes);
app.use('/api/personnel-positions', personnelPositionsRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/kits', kitsRoutes);
app.use('/api/job-assets', jobAssetsRoutes);
app.use('/api/time-reports', timeReportsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/failure-reports', failureReportsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/asset-alerts', assetAlertsRoutes);
app.use('/api/briefing', briefingRoutes);
app.use('/api/service-requirements', serviceRequirementsRoutes);

// Rutas exclusivas del entorno de demostracion: solo existen si DEMO_MODE=true.
// En produccion esta variable no esta seteada, asi que ni siquiera se monta la ruta.
if (process.env.DEMO_MODE === 'true') {
  const demoRoutes = require('./demo.routes');
  app.use('/api/demo', demoRoutes);
  console.log('DEMO_MODE activo: /api/demo/reset disponible.');
}

// Manejo generico de errores no capturados
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`WellOps API corriendo en el puerto ${PORT}`);
});

// Chequeo periodico de alertas de assets (carreras/operaciones vs umbral configurado).
// Cada 15 minutos alcanza de sobra - estos contadores no cambian a una velocidad
// que justifique algo mas frecuente, y asi no se satura la base con chequeos innecesarios.
cron.schedule('*/15 * * * *', async () => {
  try {
    const result = await checkAssetAlerts();
    if (result.triggered > 0) {
      console.log(`Chequeo de alertas de assets: ${result.triggered} alerta(s) disparada(s) de ${result.checked} regla(s) activa(s).`);
    }
  } catch (err) {
    console.error('Error en el chequeo periodico de alertas de assets:', err);
  }
});

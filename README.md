# Expro Operations System — Backend (estructura plana)



Esta es una reorganización de la versión anterior: **todos los archivos viven en una sola
carpeta, sin subcarpetas**. Es exactamente el mismo backend, con la misma lógica — el único
cambio es dónde vive cada archivo, para que subirlo a GitHub arrastrando archivos funcione
sin errores.

## Por qué se rompió la versión anterior

Al arrastrar la carpeta `expro-backend` (que tenía subcarpetas `src/` y `db/`) directo al
navegador, GitHub subió los archivos pero **sin las carpetas** — todos quedaron sueltos en la
raíz del repo. Como el código tenía líneas como `require('./src/config/db')`, al no existir
esa carpeta en el repo, Railway no pudo compilar la imagen y el deploy falló
("Failed to build an image").

Con esta versión no puede volver a pasar: no hay ninguna subcarpeta, así que no importa cómo
arrastres los archivos, todos van a terminar en el lugar correcto.

---

## PASO A PASO — Reemplazar los archivos en tu repo de GitHub

1. Andá a tu repo `expro-operations-backend` en GitHub.
2. Necesitás borrar los archivos viejos primero. La forma más simple: entrá a cada archivo,
   click en el icono de tacho de basura (🗑) arriba a la derecha del archivo, y confirmá el
   borrado. O, más rápido: borrá el repo entero y creá uno nuevo con el mismo nombre (Settings
   → Danger Zone → Delete this repository), y arrancás de cero con el Paso 3.
3. En el repo (vacío), click en **"Add file"** → **"Upload files"**.
4. Abrí la carpeta que te dejo ahora (sin subcarpetas) y seleccioná **todos los archivos que
   están adentro** (Ctrl+A o Cmd+A) y arrastralos a la ventana del navegador.
5. Confirmá que en la lista de archivos a subir **NO aparezca ningún ícono de carpeta** — solo
   archivos sueltos. Si ves alguno, es que agarró una carpeta por error.
6. Commit changes.
7. Además, creá el archivo `.gitignore` directo en GitHub (esto evita el problema de los
   archivos ocultos al arrastrar): click en **"Add file"** → **"Create new file"** → escribí
   como nombre `.gitignore` → pegá adentro el contenido de `gitignore.txt` que te dejo acá →
   Commit changes.
8. Railway va a detectar el push automáticamente (por el auto-deploy que ya tenías activado)
   y va a intentar un nuevo build. Esta vez sí debería encontrar todos los `require(...)`
   porque todo está en la misma carpeta.

---

## Variables de entorno en Railway (ya las tenías bien, según la imagen 2)

Vi en tu captura que ya tenés cargadas `CERT_SEMAPHORE_THRESHOLD_DAYS`, `DATABASE_URL`
(conectada por referencia a Postgres) y `JWT_SECRET` — eso está perfecto, no hay que tocar
nada ahí.

---

## Después del próximo deploy exitoso

Una vez que el deploy quede en verde (¿"Success"? lo vas a ver en la pestaña Deployments),
seguís con lo que ya sabíamos:

```bash
# en tu computadora, con el .env apuntando a la DATABASE_URL de Railway
npm install
npm run migrate
npm run seed
```

Y después, para cargar tu base de assets real desde SAP:

```
POST /api/assets/import-sap
Header: Authorization: Bearer <token del login>
Body: form-data, campo "file" = tu Excel de SAP
```

---

## Estructura de archivos (todos en la raíz, sin subcarpetas)

```
server.js                    ← arranca la app
db.js                        ← conexión a Postgres
schema.sql                   ← todas las tablas
migrate.js                   ← corre schema.sql
seed.js                      ← carga usuarios/clientes/servicios iniciales
authMiddleware.js            ← valida el JWT
permissionsMiddleware.js     ← controla que rol puede escribir que
semaphore.js                 ← calcula verde/amarillo/rojo
sapImport.js                 ← parsea el Excel de SAP
auth.routes.js
catalog.routes.js
jobs.routes.js
assets.routes.js
kits.routes.js
jobAssets.routes.js
timeReports.routes.js
maintenance.routes.js
settings.routes.js
package.json
env.example                  ← referencia de las variables necesarias (no es el .env real)
gitignore.txt                ← contenido a pegar en un archivo .gitignore creado desde GitHub
```

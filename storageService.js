// storageService.js
// Wrapper para Cloudflare R2 (compatible con la API de S3). Usa el SDK oficial de AWS
// apuntado al endpoint de R2 - mismo protocolo, sin necesidad de librerias propias de Cloudflare.
//
// Variables de entorno necesarias en Railway:
//   R2_ACCOUNT_ID
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET_NAME
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function getClient() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
}

// Sube un archivo (buffer en memoria, ya leido por multer) a R2.
async function uploadFile({ key, buffer, contentType }) {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream'
  }));
  return key;
}

// Genera una URL temporal firmada para descargar/ver un archivo (valida por defecto 1 hora).
async function getDownloadUrl(key, expiresInSeconds = 3600) {
  const client = getClient();
  const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

async function deleteFile(key) {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
}

module.exports = { uploadFile, getDownloadUrl, deleteFile };

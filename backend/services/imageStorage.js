const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY,
  },
});

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET;
const PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL;

async function uploadCardImage(buffer, mimetype, side, userId) {
  const ext = mimetype === 'image/png' ? 'png' : 'jpg';
  const key = `cards/${userId}/${randomUUID()}-${side}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
    CacheControl: 'public, max-age=31536000',
  }));

  return `${PUBLIC_URL}/${key}`;
}

module.exports = { uploadCardImage };

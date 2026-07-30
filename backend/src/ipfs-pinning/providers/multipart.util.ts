import { randomBytes } from 'crypto';

export interface MultipartFormData {
  body: Buffer;
  contentType: string;
}

/** Builds a minimal single-file multipart/form-data body, used by providers whose upload APIs require it. */
export function buildSingleFileMultipart(
  fieldName: string,
  filename: string,
  content: Buffer,
): MultipartFormData {
  const boundary = `----trustflow-${randomBytes(16).toString('hex')}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

  return {
    body: Buffer.concat([header, content, footer]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

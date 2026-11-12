import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

/** Lifetime of a download link: `X-Amz-Expires=900` in spec.md section 4. */
export const DOWNLOAD_URL_SECONDS = 900;

function s3Client(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'flashtix',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'flashtix-secret',
    },
  });
}

/**
 * Object storage for the ticket PDFs (C4 container `ticket-files`).
 *
 * Two clients on purpose: the service uploads through the internal address
 * (`S3_ENDPOINT`, for example http://ticket-files:9090), but the download link is opened
 * by the browser of the fan, so it must be signed for the address the browser can reach
 * (`S3_PUBLIC_ENDPOINT`, for example http://localhost:9090). The signature covers the host.
 */
@Injectable()
export class TicketStorage {
  readonly bucket = process.env.TICKET_BUCKET ?? 'tickets';
  private readonly internal = s3Client(process.env.S3_ENDPOINT ?? 'http://ticket-files:9090');
  private readonly external = s3Client(
    process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://ticket-files:9090',
  );

  async putPdf(key: string, body: Buffer): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: 'application/pdf' }),
    );
  }

  /** Best effort: used to drop a PDF whose ticket row lost a race with a concurrent delivery. */
  async delete(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
  }

  /** Time-limited link to the PDF, signed locally (no network call). */
  downloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.external, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: DOWNLOAD_URL_SECONDS,
    });
  }
}

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

/**
 * Reads the ticket PDFs from the S3 bucket to attach them to the email. The Notification
 * Worker only knows the `pdfObjectKey` that ticket.issued carries; it never reads ticket-db.
 */
@Injectable()
export class TicketFilesClient {
  private readonly bucket = process.env.TICKET_BUCKET ?? 'tickets';
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://ticket-files:9090',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'flashtix',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'flashtix-secret',
    },
  });

  async read(key: string): Promise<Buffer> {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!object.Body) throw new Error(`ticket file ${key} is empty`);
    return Buffer.from(await object.Body.transformToByteArray());
  }
}

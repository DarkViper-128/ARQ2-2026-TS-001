import PDFDocument from 'pdfkit';
import { toBuffer } from 'qrcode';

export interface TicketPdfInput {
  ticketId: string;
  orderId: string;
  qrPayload: string;
  seatId: string;
  category: string;
  event: {
    name: string;
    artist: string;
    venue: { name: string; city: string };
    startsAt: string;
  };
}

/** Prints the date the way a fan reads it, always in UTC so every replica renders the same text. */
function formatStart(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

/** Renders one ticket (A5, one page) with the QR of its signed payload. */
export async function renderTicketPdf(input: TicketPdfInput): Promise<Buffer> {
  const qr = await toBuffer(input.qrPayload, { type: 'png', width: 260, margin: 1, errorCorrectionLevel: 'M' });

  const doc = new PDFDocument({
    size: 'A5',
    margin: 36,
    info: { Title: `FlashTix ticket ${input.seatId}`, Author: 'FlashTix', Subject: input.event.name },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fontSize(10).fillColor('#666666').text('FLASHTIX - ADMIT ONE', { width });
  doc.moveDown(0.6);
  doc.fontSize(22).fillColor('#111111').text(input.event.name, { width });
  doc.fontSize(14).fillColor('#333333').text(input.event.artist, { width });
  doc.moveDown(0.8);
  doc.fontSize(11).fillColor('#111111').text(`${input.event.venue.name}, ${input.event.venue.city}`, { width });
  doc.text(formatStart(input.event.startsAt), { width });
  doc.moveDown(0.8);
  doc.fontSize(26).text(`Seat ${input.seatId}`, { width });
  doc.fontSize(11).fillColor('#333333').text(input.category, { width });

  const qrTop = doc.y + 14;
  doc.image(qr, (doc.page.width - 170) / 2, qrTop, { width: 170 });
  doc.y = qrTop + 170 + 10;

  doc.fontSize(7).fillColor('#777777');
  doc.text(`Ticket ${input.ticketId}`, { width, align: 'center' });
  doc.text(`Order ${input.orderId}`, { width, align: 'center' });

  doc.end();
  return finished;
}

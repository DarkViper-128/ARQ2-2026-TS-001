import type { Mail } from './mailer';

export interface Money {
  amount: number;
  currency: string;
}

/** Money is stored in minor units (spec.md section 2): 45000000 COP -> "COP 450,000.00". */
export function formatMoney(money: Money): string {
  return `${money.currency} ${(money.amount / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function layout(title: string, paragraphs: string[]): { text: string; html: string } {
  return {
    text: [title, '', ...paragraphs, '', 'FlashTix'].join('\n'),
    html:
      `<div style="font-family:Arial,sans-serif;max-width:520px">` +
      `<h2>${escapeHtml(title)}</h2>` +
      paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('') +
      `<p style="color:#777">FlashTix</p></div>`,
  };
}

export interface IssuedTicket {
  ticketId: string;
  seatId: string;
}

/** F5: the fan receives every ticket of the order in one email. */
export function ticketsEmail(
  to: string,
  orderId: string,
  tickets: IssuedTicket[],
  attachments: NonNullable<Mail['attachments']>,
): Mail {
  const title = tickets.length === 1 ? 'Your ticket is ready' : `Your ${tickets.length} tickets are ready`;
  const body = layout(title, [
    `Thank you for your purchase (order ${orderId}).`,
    `Seats: ${tickets.map((ticket) => ticket.seatId).join(', ')}.`,
    'Your tickets are attached as PDF files. Show the QR code at the entrance.',
  ]);
  return { to, subject: `FlashTix - ${title}`, ...body, attachments };
}

const FAILURE_TEXT: Record<string, string> = {
  PAYMENT_DECLINED: 'your payment was declined',
  PAYMENT_TIMEOUT: 'the payment provider did not answer in time',
  GATEWAY_UNAVAILABLE: 'the payment provider is not available right now',
  HOLD_EXPIRED: 'the time to complete the purchase ran out',
};

/** The seats were released and nobody was charged. */
export function orderFailedEmail(to: string, orderId: string, reason: string): Mail {
  const why = FAILURE_TEXT[reason] ?? 'the payment could not be completed';
  const body = layout('We could not complete your purchase', [
    `Your order ${orderId} was not completed because ${why}.`,
    'You were not charged and your seats were released. You can try again from the event page.',
  ]);
  return { to, subject: 'FlashTix - We could not complete your purchase', ...body };
}

const CANCELLATION_TEXT: Record<string, string> = {
  SEAT_CONFLICT: 'the seat was sold to another fan at the same moment',
  EVENT_CANCELLED: 'the event was cancelled',
};

export function orderCancelledEmail(
  to: string,
  orderId: string,
  reason: string,
  refunded: Money | undefined,
): Mail {
  const why = CANCELLATION_TEXT[reason] ?? 'the order had to be cancelled';
  const body = layout('Your order was cancelled and refunded', [
    `Your order ${orderId} was cancelled because ${why}.`,
    refunded
      ? `We refunded ${formatMoney(refunded)} to your original payment method.`
      : 'We refunded the full amount to your original payment method.',
  ]);
  return { to, subject: 'FlashTix - Your order was cancelled and refunded', ...body };
}

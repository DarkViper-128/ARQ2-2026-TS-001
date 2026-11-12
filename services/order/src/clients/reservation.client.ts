import { join } from 'node:path';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { AppError, type ErrorCode, getCorrelationId } from '@flashtix/shared';

export interface LockedHold {
  holdId: string;
  eventId: string;
  seatIds: string[];
  expiresAt: Date;
  alreadyLocked: boolean;
}

interface LockHoldResponse {
  hold_id: string;
  order_id: string;
  seat_ids: string[];
  event_id: string;
  expires_at?: { seconds: string; nanos: number };
  already_locked: boolean;
}

type LockHoldFn = (
  request: Record<string, string>,
  options: { deadline: Date },
  callback: (error: grpc.ServiceError | null, response?: LockHoldResponse) => void,
) => void;

export const PROTO_DIR = process.env.PROTO_DIR ?? join(__dirname, '..', '..', '..', '..', 'proto');

/** Codes the server may send as the status message (proto "Errors" section). */
const KNOWN_CODES: ErrorCode[] = ['HOLD_NOT_FOUND', 'HOLD_EXPIRED', 'HOLD_LOCKED', 'FORBIDDEN', 'VALIDATION_ERROR'];

/**
 * gRPC client for LockHold (ORD-3). This is the only synchronous call between services:
 * POST /orders must know BEFORE it answers whether the seats are still the fan's.
 */
@Injectable()
export class ReservationClient implements OnModuleDestroy {
  private readonly client: grpc.Client & { LockHold: LockHoldFn };
  private readonly timeoutMs = Number(process.env.RESERVATION_GRPC_TIMEOUT_MS ?? 2000);

  constructor() {
    const definition = protoLoader.loadSync(join(PROTO_DIR, 'reservation', 'v1', 'reservation.proto'), {
      keepCase: true,
      longs: String,
      defaults: true,
      includeDirs: [PROTO_DIR],
    });
    const loaded = grpc.loadPackageDefinition(definition) as unknown as {
      flashtix: { reservation: { v1: { ReservationService: grpc.ServiceClientConstructor } } };
    };
    const address = process.env.RESERVATION_GRPC_URL ?? 'reservation:50051';
    this.client = new loaded.flashtix.reservation.v1.ReservationService(
      address,
      grpc.credentials.createInsecure(),
    ) as unknown as grpc.Client & { LockHold: LockHoldFn };
  }

  lockHold(holdId: string, orderId: string, userId: string): Promise<LockedHold> {
    return new Promise((resolve, reject) => {
      this.client.LockHold(
        {
          hold_id: holdId,
          order_id: orderId,
          user_id: userId,
          correlation_id: getCorrelationId() ?? '',
        },
        { deadline: new Date(Date.now() + this.timeoutMs) },
        (error, response) => {
          if (error) {
            const code = KNOWN_CODES.find((known) => known === error.details);
            reject(
              code
                ? new AppError(code, `LockHold rejected the hold: ${code}`)
                : new AppError('SERVICE_UNAVAILABLE', 'Reservation Service is unavailable'),
            );
            return;
          }
          const expires = response!.expires_at;
          resolve({
            holdId: response!.hold_id,
            eventId: response!.event_id,
            seatIds: response!.seat_ids,
            expiresAt: new Date(Number(expires?.seconds ?? 0) * 1000 + Math.floor((expires?.nanos ?? 0) / 1e6)),
            alreadyLocked: response!.already_locked,
          });
        },
      );
    });
  }

  onModuleDestroy(): void {
    this.client.close();
  }
}

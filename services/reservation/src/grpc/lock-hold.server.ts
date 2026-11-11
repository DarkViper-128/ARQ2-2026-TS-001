import { join } from 'node:path';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { runWithCorrelationId, ensureCorrelationId } from '@flashtix/shared';
import { HoldsService, type LockOutcome } from '../holds/holds.service';

interface LockHoldRequest {
  hold_id: string;
  order_id: string;
  user_id: string;
  correlation_id: string;
}

/** Repository root `proto/` folder, both from `src` (ts-node) and from `dist`. */
export const PROTO_DIR = process.env.PROTO_DIR ?? join(__dirname, '..', '..', '..', '..', 'proto');

/**
 * Error mapping of the contract (proto/reservation/v1/reservation.proto, "Errors").
 * The `code` string travels as the status message so the Order Service can answer the
 * fan with the same problem+json code.
 */
const FAILURES: Partial<Record<LockOutcome, { status: grpc.status; code: string }>> = {
  NOT_FOUND: { status: grpc.status.NOT_FOUND, code: 'HOLD_NOT_FOUND' },
  EXPIRED: { status: grpc.status.FAILED_PRECONDITION, code: 'HOLD_EXPIRED' },
  LOCKED: { status: grpc.status.FAILED_PRECONDITION, code: 'HOLD_LOCKED' },
  FORBIDDEN: { status: grpc.status.PERMISSION_DENIED, code: 'FORBIDDEN' },
};

/**
 * RES-4. gRPC server for LockHold, the only synchronous call between services.
 * It listens on an internal port that the API Gateway does not route.
 */
@Injectable()
export class LockHoldServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LockHoldServer.name);
  private readonly server = new grpc.Server();

  constructor(private readonly holds: HoldsService) {}

  async onModuleInit(): Promise<void> {
    const definition = protoLoader.loadSync(join(PROTO_DIR, 'reservation', 'v1', 'reservation.proto'), {
      keepCase: true,
      longs: String,
      defaults: true,
      includeDirs: [PROTO_DIR],
    });
    const loaded = grpc.loadPackageDefinition(definition) as unknown as {
      flashtix: { reservation: { v1: { ReservationService: grpc.ServiceClientConstructor } } };
    };

    this.server.addService(loaded.flashtix.reservation.v1.ReservationService.service, {
      LockHold: (
        call: grpc.ServerUnaryCall<LockHoldRequest, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => void this.lockHold(call.request, callback),
    });

    const port = Number(process.env.GRPC_PORT ?? 50051);
    await new Promise<void>((resolve, reject) =>
      this.server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    this.logger.log(`LockHold gRPC listening on ${port}`);
  }

  private async lockHold(request: LockHoldRequest, callback: grpc.sendUnaryData<unknown>): Promise<void> {
    if (!request.hold_id || !request.order_id || !request.user_id) {
      callback({ code: grpc.status.INVALID_ARGUMENT, details: 'VALIDATION_ERROR' });
      return;
    }

    await runWithCorrelationId(ensureCorrelationId(request.correlation_id), async () => {
      try {
        const { outcome, record } = await this.holds.lockHold(
          request.hold_id,
          request.order_id,
          request.user_id,
        );
        const failure = FAILURES[outcome];
        if (failure || !record) {
          callback({ code: failure?.status ?? grpc.status.INTERNAL, details: failure?.code ?? 'INTERNAL_ERROR' });
          return;
        }
        callback(null, {
          hold_id: record.holdId,
          order_id: request.order_id,
          seat_ids: record.seatIds,
          event_id: record.eventId,
          expires_at: {
            seconds: String(Math.floor(record.expiresAtMs / 1000)),
            nanos: (record.expiresAtMs % 1000) * 1_000_000,
          },
          already_locked: outcome === 'ALREADY_LOCKED',
        });
      } catch (error) {
        this.logger.error(`LockHold ${request.hold_id} failed: ${String(error)}`);
        callback({ code: grpc.status.UNAVAILABLE, details: 'SERVICE_UNAVAILABLE' });
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve) => this.server.tryShutdown(() => resolve()));
  }
}

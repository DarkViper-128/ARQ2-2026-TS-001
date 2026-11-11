import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { AppError, PROBLEM_CONTENT_TYPE, getCorrelationId, toProblemDetails } from '@flashtix/shared';
import type { Request, Response } from 'express';

/** Turns every error into the `application/problem+json` body defined in spec.md section 2. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    // A Nest 404/405 is not an AppError; map it so the client still gets problem+json.
    const error =
      exception instanceof AppError || !(exception instanceof HttpException)
        ? exception
        : new AppError(exception.getStatus() === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', exception.message);

    const problem = toProblemDetails(error, getCorrelationId());

    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${problem.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
  }
}

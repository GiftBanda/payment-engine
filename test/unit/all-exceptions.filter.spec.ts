import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { HttpException, HttpStatus, NotFoundException, BadRequestException } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';

const makeHost = (url = '/test', method = 'GET') => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const getResponse = jest.fn().mockReturnValue({ status });
  const getRequest = jest.fn().mockReturnValue({ url, method });
  return {
    switchToHttp: () => ({ getResponse, getRequest }),
    json,
    status,
  } as unknown as ArgumentsHost;
};

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  it('returns 404 with correct body for NotFoundException', () => {
    const host = makeHost('/payments/missing', 'GET');
    const { status, json } = host as any;

    filter.catch(new NotFoundException('Payment not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Payment not found',
        path: '/payments/missing',
        method: 'GET',
      }),
    );
  });

  it('returns 400 with message array for BadRequestException', () => {
    const host = makeHost('/payments', 'POST');
    const { status, json } = host as any;

    filter.catch(
      new BadRequestException({ message: ['amount must be positive'], error: 'Bad Request' }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it('returns 500 for non-HttpException errors', () => {
    const host = makeHost('/internal', 'GET');
    const { status, json } = host as any;

    filter.catch(new Error('unexpected db crash'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it('includes timestamp and path in every response', () => {
    const host = makeHost('/billing/plans', 'POST');
    const { json } = host as any;

    filter.catch(new HttpException('Conflict', HttpStatus.CONFLICT), host);

    const call = json.mock.calls[0][0];
    expect(call).toHaveProperty('timestamp');
    expect(call).toHaveProperty('path', '/billing/plans');
    expect(new Date(call.timestamp).getTime()).toBeGreaterThan(0);
  });

  it('returns 409 for plain HttpException with numeric status', () => {
    const host = makeHost('/payments', 'POST');
    const { status } = host as any;

    filter.catch(new HttpException('Idempotency conflict', HttpStatus.CONFLICT), host);

    expect(status).toHaveBeenCalledWith(409);
  });
});

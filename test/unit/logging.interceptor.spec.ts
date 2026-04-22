import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

const makeContext = (method = 'GET', url = '/test', statusCode = 200): ExecutionContext => ({
  switchToHttp: () => ({
    getRequest: () => ({ method, url, body: {} }),
    getResponse: () => ({ statusCode }),
  }),
} as any);

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
  });

  it('passes the response through without modification', (done) => {
    const ctx = makeContext('POST', '/payments');
    const handler: CallHandler = { handle: () => of({ id: 'pay_001' }) };

    interceptor.intercept(ctx, handler).subscribe((value) => {
      expect(value).toEqual({ id: 'pay_001' });
      done();
    });
  });

  it('intercepts GET requests', (done) => {
    const ctx = makeContext('GET', '/health', 200);
    const handler: CallHandler = { handle: () => of({ status: 'ok' }) };

    interceptor.intercept(ctx, handler).subscribe((value) => {
      expect(value).toEqual({ status: 'ok' });
      done();
    });
  });

  it('intercepts responses regardless of HTTP method', (done) => {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    let completed = 0;

    for (const method of methods) {
      const ctx = makeContext(method, '/test');
      const handler: CallHandler = { handle: () => of(`response-${method}`) };

      interceptor.intercept(ctx, handler).subscribe((value) => {
        expect(value).toBe(`response-${method}`);
        completed++;
        if (completed === methods.length) done();
      });
    }
  });
});

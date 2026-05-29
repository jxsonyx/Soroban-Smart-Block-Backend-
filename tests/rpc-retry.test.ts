import { describe, it, expect, vi } from 'vitest';
import { retry } from '../src/indexer/rpc';

describe('retry with network errors', () => {
  it('recovers after 5 consecutive network failures', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      if (calls <= 5) {
        const err = new Error('ETIMEDOUT');
        (err as any).code = 'ETIMEDOUT';
        throw err;
      }
      return Promise.resolve('ok');
    });

    const result = await retry(fn);
    expect(result).toBe('ok');
    expect(calls).toBe(6);
  });

  it('retries on 429 rate limit and succeeds', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      if (calls <= 2) {
        const err: any = new Error('Too Many Requests');
        err.response = { status: 429 };
        throw err;
      }
      return Promise.resolve('success');
    });

    const result = await retry(fn);
    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('throws immediately on non-retryable 5xx error', async () => {
    const fn = vi.fn().mockImplementation(() => {
      const err: any = new Error('Internal Server Error');
      err.response = { status: 500 };
      throw err;
    });

    await expect(retry(fn)).rejects.toThrow('Internal Server Error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on ECONNREFUSED and recovers', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      if (calls <= 3) {
        const err = new Error('connect ECONNREFUSED');
        (err as any).code = 'ECONNREFUSED';
        throw err;
      }
      return Promise.resolve({ data: 'ok' });
    });

    const result = await retry(fn);
    expect(result).toEqual({ data: 'ok' });
    expect(calls).toBe(4);
  });

  it('gives up after 7 failures (1 initial + 6 retries)', async () => {
    const fn = vi.fn().mockImplementation(() => {
      const err = new Error('ETIMEDOUT');
      (err as any).code = 'ETIMEDOUT';
      throw err;
    });

    await expect(retry(fn)).rejects.toThrow('ETIMEDOUT');
    expect(fn).toHaveBeenCalledTimes(7);
  }, 15000);
});

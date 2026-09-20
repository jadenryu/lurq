import { describe, expect, it, vi } from 'vitest';
import { withSetupOnMissingKey } from '../src/cli/install';
import { MissingKeyError, RemoteError } from '../src/cli/remote';

describe('withSetupOnMissingKey', () => {
  it('runs setup and retries the command when the key is missing and the user agrees', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new MissingKeyError())
      .mockResolvedValueOnce(undefined);
    const setup = vi.fn().mockResolvedValue(undefined);
    await withSetupOnMissingKey(run, async () => true, setup);
    expect(setup).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps the original error when the user declines', async () => {
    const setup = vi.fn();
    await expect(
      withSetupOnMissingKey(
        () => Promise.reject(new MissingKeyError()),
        async () => false,
        setup,
      ),
    ).rejects.toBeInstanceOf(MissingKeyError);
    expect(setup).not.toHaveBeenCalled();
  });

  it('does not offer setup for a key the server rejected', async () => {
    const ask = vi.fn();
    await expect(
      withSetupOnMissingKey(() => Promise.reject(new RemoteError('Invalid API key.', 401)), ask),
    ).rejects.toThrow('Invalid API key.');
    expect(ask).not.toHaveBeenCalled();
  });

  it('retries once only: a cancelled setup surfaces the error instead of looping', async () => {
    const run = vi.fn().mockRejectedValue(new MissingKeyError());
    const setup = vi.fn().mockResolvedValue(undefined);
    await expect(withSetupOnMissingKey(run, async () => true, setup)).rejects.toBeInstanceOf(
      MissingKeyError,
    );
    expect(run).toHaveBeenCalledTimes(2);
  });
});

import { resolveListenHost } from './listen-host';

describe('resolveListenHost', () => {
  it('usa 127.0.0.1 si no hay API_HOST', () => {
    expect(resolveListenHost({})).toBe('127.0.0.1');
  });

  it('usa 127.0.0.1 si API_HOST viene vacío', () => {
    expect(resolveListenHost({ API_HOST: '' })).toBe('127.0.0.1');
  });

  it('usa 127.0.0.1 si API_HOST solo tiene espacios', () => {
    expect(resolveListenHost({ API_HOST: '  ' })).toBe('127.0.0.1');
  });

  it('respeta un API_HOST explícito', () => {
    expect(resolveListenHost({ API_HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });
});

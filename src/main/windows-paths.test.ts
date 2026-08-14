import { describe, expect, it } from 'vitest';
import { windowsSystemExecutable } from './windows-paths.js';

describe('windowsSystemExecutable', () => {
  it('uses SystemRoot when it is available', () => {
    expect(windowsSystemExecutable({ SystemRoot: 'C:\\Windows' }, 'reg.exe')).toBe(
      'C:\\Windows\\System32\\reg.exe',
    );
  });

  it('falls back to WINDIR', () => {
    expect(windowsSystemExecutable({ WINDIR: 'D:\\Windows' }, 'reg.exe')).toBe(
      'D:\\Windows\\System32\\reg.exe',
    );
  });

  it('rejects missing roots and executable paths', () => {
    expect(() => windowsSystemExecutable({}, 'reg.exe')).toThrow('Windows SystemRoot is unavailable');
    expect(() => windowsSystemExecutable({ SystemRoot: 'C:\\Windows' }, '..\\reg.exe')).toThrow(
      'Invalid Windows system executable name',
    );
  });
});

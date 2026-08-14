import { win32 } from 'node:path';

export function windowsSystemExecutable(
  environment: Readonly<Record<string, string | undefined>>,
  executable: string,
): string {
  const windowsRoot = environment.SystemRoot || environment.WINDIR;
  if (!windowsRoot) throw new Error('Windows SystemRoot is unavailable');
  if (!executable || executable.includes('/') || executable.includes('\\')) {
    throw new Error('Invalid Windows system executable name');
  }
  return win32.join(windowsRoot, 'System32', executable);
}

/**
 * Open a file or URL in the OS default application, cross-platform.
 *
 * No shell (so a target containing shell metacharacters can't inject a command);
 * on Windows `cmd /c start "" <target>` keeps spaced paths intact because Node
 * passes each argument separately. Best-effort by design: a headless box has no
 * browser to open, and the callers all print the URL as well.
 */
import { spawn } from 'node:child_process';

export function openInBrowser(target: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [target]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', target]]
        : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* no opener available (headless/CI); the caller prints the URL too */
  }
}

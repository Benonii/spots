/** Thin Bun.spawn wrapper: capture stdout/stderr, throw on nonzero by default. */
export type RunResult = { stdout: string; stderr: string; code: number };

export async function run(
  cmd: string[],
  opts: { allowNonZero?: boolean } = {},
): Promise<RunResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: process.env });
  } catch (e) {
    // e.g. ENOENT when the binary isn't on PATH.
    throw new Error(`Could not run "${cmd[0]}": ${(e as Error).message}`);
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0 && !opts.allowNonZero) {
    throw new Error(
      `Command failed (exit ${code}): ${cmd.join(" ")}\n${stderr.trim()}`,
    );
  }
  return { stdout, stderr, code };
}

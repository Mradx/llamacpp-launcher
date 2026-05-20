import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export interface TerminalViewport {
  rows: number;
  columns: number;
}

const FALLBACK_VIEWPORT: TerminalViewport = {
  rows: 24,
  columns: 80,
};

function readViewport(stdout: NodeJS.WriteStream | undefined): TerminalViewport {
  const rows = typeof stdout?.rows === 'number' && stdout.rows > 0
    ? stdout.rows
    : FALLBACK_VIEWPORT.rows;
  const columns = typeof stdout?.columns === 'number' && stdout.columns > 0
    ? stdout.columns
    : FALLBACK_VIEWPORT.columns;

  return { rows, columns };
}

export function useTerminalViewport(): TerminalViewport {
  const { stdout } = useStdout();
  const stream = stdout as NodeJS.WriteStream | undefined;
  const [viewport, setViewport] = useState<TerminalViewport>(() => readViewport(stream));

  useEffect(() => {
    const update = () => {
      const next = readViewport(stream);
      setViewport(prev => (
        prev.rows === next.rows && prev.columns === next.columns ? prev : next
      ));
    };

    update();
    stream?.on?.('resize', update);

    return () => {
      stream?.off?.('resize', update);
    };
  }, [stream]);

  return viewport;
}

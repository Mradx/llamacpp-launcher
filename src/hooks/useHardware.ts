import { useState, useEffect } from 'react';
import type { HardwareInfo, NetworkInfo } from '../types.js';
import { detectHardware } from '../services/hardware.js';
import { detectNetwork } from '../services/network.js';

export function useHardware(port: number) {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      const [hw, net] = await Promise.all([
        detectHardware(),
        detectNetwork(port),
      ]);
      if (!cancelled) {
        setHardware(hw);
        setNetwork(net);
        setLoading(false);
      }
    }

    detect();
    return () => { cancelled = true; };
  }, [port]);

  return { hardware, network, loading };
}

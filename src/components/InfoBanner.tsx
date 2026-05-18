import React from 'react';
import { Box, Text } from 'ink';
import type { HardwareInfo, NetworkInfo, FullSelection, Config } from '../types.js';
import { formatNumber, formatMb } from '../utils/format.js';
import { theme } from '../theme.js';

interface InfoBannerProps {
  config: Config;
  hardware: HardwareInfo | null;
  network: NetworkInfo | null;
  selection: FullSelection;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Box width={12}>
        <Text color={theme.accent} bold>{label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

export function InfoBanner({ config, hardware, network, selection }: InfoBannerProps) {
  const modelLabel = selection.model.label;
  const gpuInfo = hardware
    ? `${hardware.gpuName} │ ${formatMb(hardware.vramMb)}`
    : 'Detecting...';
  const cpuInfo = hardware
    ? `${hardware.cpuName} │ ${formatMb(hardware.ramMb)} RAM`
    : 'Detecting...';

  return (
    <Box flexDirection="column" marginBottom={1} paddingX={2}>
      <InfoRow label="Model" value={modelLabel} />
      <InfoRow label="Engine" value={config.serverExe} />
      <InfoRow label="GPU" value={gpuInfo} />
      <InfoRow label="CPU" value={cpuInfo} />
      <Text> </Text>
      <InfoRow label="Local" value={network?.localUrl || `http://localhost:${config.port}`} />
      <InfoRow label="Network" value={network?.lanUrl || 'unavailable'} />
      <Text> </Text>
      <Box>
        <Text dimColor>
          Context {formatNumber(selection.contextSize)} │ Layers {config.gpuLayers} │ Slots {config.parallelSlots} │ MTP {selection.mtpEnabled ? 'on' : 'off'}
        </Text>
      </Box>
    </Box>
  );
}

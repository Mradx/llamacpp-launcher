import React from 'react';
import { Box, Text } from 'ink';
import { LLAMA_CPP_LOGO } from '../brand.js';
import { theme } from '../theme.js';
import { PAGE_MARGIN_X } from '../layout.js';
import { TitleBlock } from './TitleBlock.js';
import type { VersionInfo } from '../services/llamacpp-version.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { truncateText } from '../utils/terminal.js';

interface HeaderProps {
  title: string;
  subtitle?: string;
  version?: VersionInfo | null;
}

export function Header({ title, subtitle, version }: HeaderProps) {
  const showBrandHeader = title === 'LOCAL MODELS';

  return (
    <Box flexDirection="column" marginBottom={0} marginLeft={PAGE_MARGIN_X}>
      {showBrandHeader && (
        <>
          <Box flexDirection="column">
            {LLAMA_CPP_LOGO.map((line, index) => (
              <Box key={index}>
                <Text color={theme.logoText} bold>{line.llama}</Text>
                <Text color={theme.logoAccent} bold>{line.cpp}</Text>
              </Box>
            ))}
          </Box>
          {version?.local && (
            <Box marginTop={0}>
              <VersionLine version={version} />
            </Box>
          )}
        </>
      )}
      <Box marginTop={showBrandHeader ? 1 : 0}>
        <TitleBlock title={title} subtitle={subtitle} />
      </Box>
    </Box>
  );
}

function VersionLine({ version }: { version: VersionInfo }) {
  const { columns } = useTerminalViewport();
  const maxTextWidth = Math.max(20, columns - 4);
  const { local, remote, buildsBehind } = version;
  const localLabel = local.tag
    ? `${local.tag} (${local.commit})`
    : local.commit;

  if (!remote) {
    return <Text dimColor>{truncateText(`build ${localLabel}`, maxTextWidth)}</Text>;
  }

  if (buildsBehind === 0) {
    return <Text color={theme.success}>{truncateText(`build ${localLabel} - up to date`, maxTextWidth)}</Text>;
  }

  const behindColor = buildsBehind !== null && buildsBehind > 100
    ? theme.danger
    : theme.warning;
  const label = `build ${localLabel} - latest ${remote.tag}${buildsBehind !== null ? ` - ${buildsBehind} builds behind` : ''}`;

  return <Text color={behindColor}>{truncateText(label, maxTextWidth)}</Text>;
}

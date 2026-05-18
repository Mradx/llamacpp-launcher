import React from 'react';
import { Box, Text } from 'ink';
import { LLAMA_CPP_LOGO } from '../brand.js';
import { theme } from '../theme.js';
import { PAGE_MARGIN_X } from '../layout.js';
import { TitleBlock } from './TitleBlock.js';
import type { VersionInfo } from '../services/llamacpp-version.js';

interface HeaderProps {
  title: string;
  subtitle?: string;
  version?: VersionInfo | null;
}

export function Header({ title, subtitle, version }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={0} marginLeft={PAGE_MARGIN_X}>
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
      <Box marginTop={1}>
        <TitleBlock title={title} subtitle={subtitle} />
      </Box>
    </Box>
  );
}

function VersionLine({ version }: { version: VersionInfo }) {
  const { local, remote, buildsBehind } = version;
  const localLabel = local.tag
    ? `${local.tag} (${local.commit})`
    : local.commit;

  if (!remote) {
    return (
      <Text dimColor>build {localLabel}</Text>
    );
  }

  if (buildsBehind === 0) {
    return (
      <Box>
        <Text dimColor>build </Text>
        <Text color={theme.success}>{localLabel}</Text>
        <Text dimColor> · </Text>
        <Text color={theme.success}>up to date</Text>
      </Box>
    );
  }

  const behindColor = buildsBehind !== null && buildsBehind > 100
    ? theme.danger
    : theme.warning;

  return (
    <Box>
      <Text dimColor>build </Text>
      <Text color={behindColor}>{localLabel}</Text>
      <Text dimColor> · latest </Text>
      <Text color={theme.success}>{remote.tag}</Text>
      {buildsBehind !== null && (
        <>
          <Text dimColor> · </Text>
          <Text color={behindColor}>{buildsBehind} builds behind</Text>
        </>
      )}
    </Box>
  );
}

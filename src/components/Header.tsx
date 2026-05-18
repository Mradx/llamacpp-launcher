import React from 'react';
import { Box, Text } from 'ink';
import { LLAMA_CPP_LOGO } from '../brand.js';
import { theme } from '../theme.js';
import { PAGE_MARGIN_X } from '../layout.js';
import { TitleBlock } from './TitleBlock.js';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
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
      <Box marginTop={1}>
        <TitleBlock title={title} subtitle={subtitle} />
      </Box>
    </Box>
  );
}

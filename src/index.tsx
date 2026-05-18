#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { isFirstRun } from './config.js';
import { FirstRunSetup } from './screens/FirstRunSetup.js';
import { runSelection } from './selection.js';
import { launchServer } from './launch.js';

if (isFirstRun()) {
  await new Promise<void>((resolve) => {
    const { waitUntilExit } = render(
      <FirstRunSetup onDone={resolve} />
    );
    waitUntilExit();
  });
}

const result = await runSelection();
launchServer(result);

#!/usr/bin/env node
import { runSelection } from './selection.js';
import { launchServer } from './launch.js';

const result = await runSelection();
launchServer(result);

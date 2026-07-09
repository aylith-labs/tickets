#!/usr/bin/env bun
import { runCli } from './cli-run';

await runCli(process.argv.slice(2));

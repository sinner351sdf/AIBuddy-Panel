#!/usr/bin/env node
// Generate web brand assets and desktop icon source from the same SVG geometry.
// Install once: npm --prefix assets/brand/generator ci
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { generate } = require('../assets/brand/generator/gen.js');
const { generateRasters } = require('../assets/brand/generator/render.js');
generate();
generateRasters();

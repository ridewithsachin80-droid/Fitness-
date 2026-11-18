// Uploaded repositories may retain compiled service workers and obsolete
// bundles. Start each build from source so PWA manifest injection is repeatable.
import { rm } from 'node:fs/promises';
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });

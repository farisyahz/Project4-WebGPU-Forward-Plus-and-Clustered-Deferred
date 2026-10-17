import { cp } from 'node:fs/promises';

await cp(new URL('../scenes/', import.meta.url), new URL('../dist/scenes/', import.meta.url), { recursive: true });

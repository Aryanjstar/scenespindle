import next from 'eslint-config-next';
import typescript from 'eslint-config-next/typescript';
export default [...next, ...typescript, { ignores: ['spikes/**', '.data/**', '.agents/**', '.codex/**', '.claude/**'] }];

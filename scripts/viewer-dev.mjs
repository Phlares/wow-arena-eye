// Run the API server (tsx, --experimental-sqlite) and the Vite dev server together.
// Vite proxies /api -> the API port (configured in web/vite.config.ts). Ctrl-C stops both.
import { spawn } from 'node:child_process';

const opts = { stdio: 'inherit', shell: true };
const api = spawn('node', ['--experimental-sqlite', '--import', 'tsx', 'src/viewer/server.ts'], { ...opts, env: { ...process.env, WAE_VIEWER_PORT: '5174' } });
const web = spawn('npm', ['run', 'dev', '--prefix', 'web'], opts);
const kill = () => { api.kill(); web.kill(); };
process.on('SIGINT', kill); process.on('SIGTERM', kill);
api.on('exit', kill); web.on('exit', kill);

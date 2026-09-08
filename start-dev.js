const net = require('net');
const { spawn, exec } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const APP_DIR = __dirname;
process.chdir(APP_DIR);
process.env.INIT_CWD = APP_DIR;
process.env.PWD = APP_DIR;
const nodeModulesPath = path.join(APP_DIR, 'node_modules');
process.env.NODE_PATH = nodeModulesPath + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');

function killOldNextProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const psCmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name='node.exe'\\" | Where-Object { $_.CommandLine -like '*next*' -or $_.CommandLine -like '*pdf-editor*' } | Where-Object { $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
      exec(psCmd, () => resolve());
    } else {
      exec(`pkill -f "next dev" >/dev/null 2>&1`, () => resolve());
    }
  });
}

function removeDevLock() {
  const lockFile = path.join(APP_DIR, '.next', 'dev', 'lock');
  if (fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
      console.log('[Info] Ausstehende Sperrdatei (.next/dev/lock) wurde gelöscht.');
    } catch (e) {
      console.warn('[Warnung] Konnte lock-Datei nicht löschen:', e.message);
    }
  }
}

function waitForServer(host, port, nextProcess) {
  return new Promise((resolve) => {
    let done = false;
    let attempts = 0;

    const finish = (result) => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };

    const checkOutput = (chunk) => {
      const str = chunk.toString();
      if (str.includes('EADDRINUSE') || str.includes('Unable to acquire lock')) {
        finish(false);
      }
    };

    nextProcess.stdout.pipe(process.stdout);
    nextProcess.stderr.pipe(process.stderr);

    nextProcess.stdout.on('data', checkOutput);
    nextProcess.stderr.on('data', checkOutput);

    const check = () => {
      if (done) return;
      const req = http.get(`http://${host}:${port}/`, (res) => {
        res.resume();
        finish(true);
      });
      req.on('error', () => {
        attempts++;
        if (attempts > 40) return finish(false);
        if (!done) setTimeout(check, 400);
      });
      req.setTimeout(12000, () => {
        req.destroy();
        attempts++;
        if (attempts > 40) return finish(false);
        if (!done) setTimeout(check, 400);
      });
      req.end();
    };

    check();
  });
}

async function startNextServer(startPort = 3000) {
  let port = startPort;
  const host = '127.0.0.1';

  while (port <= startPort + 10) {
    console.log(`-> Starte Next.js Server auf http://${host}:${port}/ ...\n`);

    const nextBin = process.platform === 'win32'
      ? path.join(APP_DIR, 'node_modules', '.bin', 'next.cmd')
      : path.join(APP_DIR, 'node_modules', '.bin', 'next');

    const spawnCmd = process.platform === 'win32' ? 'cmd.exe' : nextBin;
    const spawnArgs = process.platform === 'win32'
      ? ['/c', nextBin, 'dev', '--webpack', '-H', host, '-p', port.toString()]
      : ['dev', '--webpack', '-H', host, '-p', port.toString()];

    const nextProcess = spawn(spawnCmd, spawnArgs, {
      cwd: APP_DIR,
      env: {
        ...process.env,
        INIT_CWD: APP_DIR,
        PWD: APP_DIR,
        NODE_PATH: nodeModulesPath + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const isReady = await waitForServer(host, port, nextProcess);

    if (isReady) {
      return { nextProcess, port, host };
    }

    console.log(`\n[Port-Info] Port ${port} war belegt oder gesperrt. Versuche nächsten Port ${port + 1}...\n`);
    try { nextProcess.kill('SIGKILL'); } catch (e) {}
    port++;
    await new Promise(r => setTimeout(r, 200));
  }

  throw new Error('Kein freier Port verfügbar.');
}

async function main() {
  console.log('===================================================');
  console.log(' PDF Editor Pro - Server-Start');
  console.log('===================================================\n');

  console.log('1. Bereinige alte Next.js Hintergrundprozesse...');
  await killOldNextProcesses();

  console.log('2. Entferne eventuelle Dev-Sperrdateien...');
  removeDevLock();

  await new Promise(r => setTimeout(r, 400));

  console.log('3. Starte Anwendung...');
  const { nextProcess, port, host } = await startNextServer(3000);

  console.log(`\n===================================================`);
  console.log(` SERVER BEREIT! Öffne Browser...`);
  console.log(` URL: http://${host}:${port}/`);
  console.log(`===================================================\n`);

  const openCmd = process.platform === 'win32' ? `start http://${host}:${port}/` : `open http://${host}:${port}/`;
  exec(openCmd);

  process.on('SIGINT', () => {
    try { nextProcess.kill('SIGINT'); } catch(e) {}
    removeDevLock();
    process.exit();
  });

  process.on('SIGTERM', () => {
    try { nextProcess.kill('SIGTERM'); } catch(e) {}
    removeDevLock();
    process.exit();
  });

  // Keep start-dev.js running until nextProcess terminates
  await new Promise((resolve) => {
    nextProcess.on('exit', resolve);
  });
}

main().catch((err) => {
  console.error('Fehler beim Starten des Servers:', err);
  process.exit(1);
});

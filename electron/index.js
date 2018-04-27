// Copyright 2015-2017 Parity Technologies (UK) Ltd.
// This file is part of Parity.

// Parity is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// Parity is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with Parity.  If not, see <http://www.gnu.org/licenses/>.

// eslint-disable-next-line
const dynamicRequire = typeof __non_webpack_require__ === 'undefined' ? require : __non_webpack_require__; // Dynamic require https://github.com/yargs/yargs/issues/781

const argv = dynamicRequire('yargs').argv;
const electron = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const url = require('url');

const addMenu = require('./menu');

let parity; // Will hold the parity process (if spawned by node)
const parityInstallLocation = require('./util/parityInstallLocation');

const { app, BrowserWindow, ipcMain, session } = electron;
let mainWindow;

// Will send these variables to renderers via IPC
global.dirName = __dirname;
global.wsInterface = argv['ws-interface'];
global.wsPort = argv['ws-port'];
parityInstallLocation()
  .then((location) => { global.parityInstallLocation = location; })
  .catch(() => { });

function createWindow () {
  mainWindow = new BrowserWindow({
    height: 800,
    width: 1200
  });

  if (argv.dev === true) {
    // Opens http://127.0.0.1:3000 in --dev mode
    mainWindow.loadURL('http://127.0.0.1:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // Opens file:///path/to/.build/index.html in prod mode
    mainWindow.loadURL(
      url.format({
        pathname: path.join(__dirname, '..', '.build', 'index.html'),
        protocol: 'file:',
        slashes: true
      })
    );
  }

  // Listen to messages from renderer process
  ipcMain.on('asynchronous-message', (event, arg) => {
    switch (arg) {
      case 'run-parity': {
        // Run an instance of parity if we receive the `run-parity` message
        parity = spawn(global.parityInstallLocation, ['--ws-origins', 'parity://*.ui.parity']); // Argument for retro-compatibility with <1.10 versions
        break;
      }
      case 'signer-new-token': {
        // Generate a new token if we can find the parity binary
        if (!global.parityInstallLocation) { return; }
        const paritySigner = spawn(global.parityInstallLocation, ['signer', 'new-token']);

        // Listen to the output of the previous command
        paritySigner.stdout.on('data', (data) => {
          // If the output line is xxxx-xxxx-xxxx-xxxx, then it's our token
          const match = data.toString().match(/[a-zA-Z0-9]{4}(-)?[a-zA-Z0-9]{4}(-)?[a-zA-Z0-9]{4}(-)?[a-zA-Z0-9]{4}/);

          if (match) {
            const token = match[0];

            // Send back the token to the renderer process
            event.sender.send('asynchronous-reply', token);
            paritySigner.kill(); // We don't need the signer anymore
          }
        });
        break;
      }
      default:
    }
  });

  // Add application menu
  addMenu(mainWindow);

  // WS calls have Origin `file://` by default, which is not trusted.
  // We override Origin header on all WS connections with an authorized one.
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: ['ws://*/*', 'wss://*/*']
  }, (details, callback) => {
    details.requestHeaders.Origin = `parity://${mainWindow.id}.ui.parity`;
    callback({ requestHeaders: details.requestHeaders });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (parity) {
    parity.kill();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

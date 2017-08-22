'use strict';

let debug = false;

const { app, BrowserWindow } = require('electron');

// Ignore arguments that don't end in .j, .class, or .jar (case insensitive)
const argFiles = process.argv.slice(1).filter(f => /\.(j|class|jar)$/i.test(f));

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let windows = new Set();

const createWindow = (fileName) => {
  // Create the browser window.
  const new_window = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 640,
    minHeight: 400,
    center: true,
    resizable: true,
    fullscreen: false,
    fullscreenable: true,
    backgroundColor: '#000',
    show: false
  });

  // and load the index.html of the app.
  new_window.loadURL(`file://${__dirname}/ui/index.html`);

  // Open the DevTools.
  if (debug) new_window.webContents.openDevTools();
  new_window.setMenu(null);

  // Emitted when the window is closed.
  new_window.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    windows.delete(new_window);
  });

  new_window.on('ready-to-show',()=>{
      new_window.show();
  });

  new_window.argFile = fileName;
  windows.add(new_window);
  return new_window;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  argFiles.forEach(file => createWindow(file));

  if (!argFiles.length) {
    createWindow();
  }
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (windows.size === 0) {
    createWindow();
  }
});

global.openFile = function(file) {
  createWindow(file).focus();
};

global.restart = function() {
    app.relaunch();
    app.quit();
};

// global.isMainWindow = function(win) {
//     return (windows.indexOf(win)===0);
// };


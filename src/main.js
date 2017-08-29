'use strict';

const debug = false;

const electron = require('electron');

const fs = require('fs');

const path = require('path');

const crypto = require('crypto');

const jszip = require('./jszip/jszip.min.js');

const mkdirP = require('./mkdirP/index.js');

const app = electron.app;

let argFiles = [];

let windows = [];

if (process.argv.length > 1){
    for (let n = 1 ; n < process.argv.length; ++n) {
        if (process.argv[n].toLowerCase().endsWith('.j')) argFiles.push(process.argv[n]);
        else if (process.argv[n].toLowerCase().endsWith('.class')) argFiles.push(process.argv[n]);
        else if (process.argv[n].toLowerCase().endsWith('.jar')) argFiles.push(process.argv[n]);
    }
}

let shouldQuit = app.makeSingleInstance(function(commandLine, workingDirectory) {
    let newArgFiles = [];
    if (commandLine.length > 1){
        for (let n = 1 ; n < commandLine.length; ++n) {
            if (commandLine[n].toLowerCase().endsWith('.j')) newArgFiles.push(commandLine[n]);
            else if (commandLine[n].toLowerCase().endsWith('.class')) newArgFiles.push(commandLine[n]);
            else if (commandLine[n].toLowerCase().endsWith('.jar')) newArgFiles.push(commandLine[n]);
        }
    }
    if (newArgFiles.length>0){
        newArgFiles.forEach((file)=>{
           windows.push(createMainWindow(file));
        });
    }
    else windows.push(createMainWindow());
    newArgFiles.forEach((file)=>{argFiles.push(file)});
});

if (shouldQuit) {
    app.quit();
    return;
}

function onClosed() {
    let index = windows.indexOf(this);
    if (index >= 0) windows.splice(index,1);
}

function createMainWindow(argFile) {
    const win = new electron.BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 640,
        minHeight: 400,
        center: true,
        resizable: true,
        fullscreen: false,
        fullscreenable: true,
        backgroundColor: '#000',
        show: false,
        webPreferences: {
            nodeIntegrationInWorker: true
        }
    });

    if (debug) win.webContents.openDevTools({detach:true});
    win.setMenu(null);

    win.argFile = argFile;

    win.loadURL('file://' + path.resolve(__dirname,'..','volcano.asar','index.html'));

    win.on('closed', onClosed);

    win.on('ready-to-show',()=>{
        win.show();
    });

    return win;
}

function doReady() {
    if (windows.length === 0) {
        if (argFiles.length>0){
            argFiles.forEach((file)=>{
                windows.push(createMainWindow(file));
            });
        }
        else windows.push(createMainWindow());
    }
}

function updatePackages(callback) {
    try{
        let installFolder = path.dirname(process.argv[0]);
        let resourceFolder = path.resolve(installFolder,'resources');
        let patchFiles = [];

        fs.readdirSync(resourceFolder).forEach(file => {
            let match = /^volcano_patch_([0-9]+)_([0-9a-f]+)$/.exec(file);
            if (match) patchFiles.push({path:path.resolve(resourceFolder,file), rolling:match[1], hash:match[2]});
        });

        if (patchFiles.length > 0) {
            patchFiles.sort((a, b) => { return a.rolling < b.rolling ? -1 : 1; });

            const checkHashTasks = patchFiles.map((file) => new Promise((resolve, reject) => {
                try {
                    let hash = crypto.createHash('md5');
                    let stream = fs.createReadStream(file.path);
                    stream.on('data', function (data) {
                        hash.update(data, 'utf8')
                    });
                    stream.on('end', function () {
                        file.cHash = hash.digest('hex');
                        file.isOk = (file.cHash === file.hash);
                        resolve();
                    });
                }
                catch (Err) {reject();}
            }));

            Promise.all(checkHashTasks).then(() => {
                function extractPatch(npatch) {
                    let file;
                    if (npatch < patchFiles.length) file = patchFiles[npatch];
                    else {
                        callback();
                        return;
                    }

                    if (debug) console.log('Applying patch [' + file.rolling + ']');
                    fs.readFile(file.path, function (err, data) {
                        if (err) {
                            if (debug) console.log(err);
                            extractPatch(npatch + 1);
                            return;
                        }
                        jszip.loadAsync(data).then((zip) => {
                            const extractTasks = [];
                            Object.keys(zip.files).forEach((filename) => {
                                if (!zip.files[filename].dir) {
                                    extractTasks.push(new Promise((resolve, reject) => {
                                        zip.files[filename].async('nodebuffer').then((content) => {
                                            if (debug) console.log('FILENAME:' + filename);
                                            let dest = path.resolve(resourceFolder, filename);
                                            let folder = path.dirname(dest);
                                            if (!fs.existsSync(folder)) mkdirP.sync(folder);
                                            fs.writeFileSync(dest, content);
                                            resolve();
                                        }).catch((err) => {
                                            if (debug) console.log(err);
                                            reject(err);
                                        });
                                    }));
                                }
                            });
                            Promise.all(extractTasks).then(() => {
                                if (debug) console.log('All extracted');
                                fs.unlink(file.path, (err) => {});
                                extractPatch( npatch + 1);
                            }).catch((err) => {
                                if (debug) console.log(err);
                                fs.unlink(file.path, (err) => {});
                                extractPatch( npatch + 1);
                            });
                        }).catch((err) => {
                            if (debug) console.log(err);
                            fs.unlink(file.path, (err) => {});
                            extractPatch( npatch + 1);
                        });
                    });
                }

                try {
                    let n = 0;
                    while (n < patchFiles.length) {
                        if (!patchFiles[n].isOk) {
                            fs.unlink(patchFiles[n].path, (err) => {});
                            patchFiles.splice(n,1);
                        }
                        else ++n;
                    }
                    if (patchFiles.length > 0) extractPatch(0);
                }
                catch (err) {
                    if (debug) console.log(err);
                    callback();
                }
            });
        }
        else callback();
    }
    catch(err) {
        if (debug) console.log(err);
        callback();
    }
}

global.openFile = function(file) {
    let window = createMainWindow(file);
    windows.push(window);
    window.focus();
};

global.restart = function() {
    app.relaunch();
    app.quit();
};

global.isMainWindow = function(win) {
    return (windows.indexOf(win)===0);
};

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('ready', () => {
    updatePackages(()=>{
        doReady();
    });
});



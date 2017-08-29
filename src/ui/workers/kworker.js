const debug = false;
const path = require('path');
const fs = require('fs');
const pathIsInside = require('../path-is-inside');
const krakatau = require('../krakatau');
const jszip  = require('../../app.asar/jszip/jszip.min.js');
const mkdirP = require('../../app.asar/mkdirP/index.js');
const timestamp = new Date().getTime();

function traverseFolder(stopOnError, recursive, folder, fileCallback, _level) {
    _level = _level || 0;
    let dirContent = fs.readdirSync(folder);
    for (let i in dirContent) {
        let entry = dirContent[i];
        let entryPath = path.resolve(folder,entry);
        let info = fs.lstatSync(entryPath);
        if (info.isFile()) {
            if (!fileCallback(entryPath) && stopOnError) return false;
        }
        else if (info.isDirectory() && recursive) {
            if (!traverseFolder(stopOnError, recursive, entryPath, fileCallback, _level + 1) && stopOnError) return false;
        }
    }
    if (_level === 0) fileCallback(null);
    return true;
}

function disassemble(data, inputFile, outputDir, roundtrip, overwrite) {
    const result = krakatau.disassemble(data, roundtrip);
    const clsName = result.name || ('no_class_name_' + timestamp);
    let outPath = path.resolve(outputDir, ...clsName.split('/')) + '.j';
    if (!pathIsInside(outPath,outputDir) || outPath.length > 255 )
        outPath = path.resolve(outputDir, path.basename(inputFile).replace(/\.class$/,'')) + '.j';
    if (overwrite) {
        let folder = path.dirname(outPath);
        if (!fs.existsSync(folder)) mkdirP.sync(folder);
        fs.writeFileSync(outPath, result.data);
    }
    else {
        if (fs.existsSync(outPath))
            outPath = outPath.replace(/\.j$/, '_' + timestamp + '.j');
        let folder = path.dirname(outPath);
        if (!fs.existsSync(folder)) mkdirP.sync(folder);
        fs.writeFileSync(outPath, result.data, {flag: "wx"});
    }
    return outPath;
}

function disassembleJar(inputFile, outputDir, roundtrip, overwrite) {
    const data = fs.readFileSync(inputFile);
    jszip.loadAsync(data).then((zip) => {
        let extractTasks = [];
        let total = 0;
        let processed = 0;
        Object.keys(zip.files).forEach((filename) => {
            if (!zip.files[filename].dir && filename.endsWith('.class')) { ++total; }});

        Object.keys(zip.files).forEach((filename) => {
            if (!zip.files[filename].dir && filename.endsWith('.class')) {
                extractTasks.push(new Promise((resolve, reject) => {
                    zip.files[filename].async('nodebuffer').then((content) => {
                        const result = disassemble(content, filename, outputDir, roundtrip, overwrite);
                        ++processed;
                        postMessage({ success:true, result:result, total:total, processed:processed });
                        resolve();
                    }).catch((err) => {
                        reject(err.toString());
                    });
                }));
            }
        });

        Promise.all(extractTasks).then(() => {
            postMessage({ success:true, result:inputFile, close:true });
        }).catch((err)=>{
            postMessage({ success:false, result:err.toString(), close:true });
        });

    }).catch((err) => {
        postMessage({ success:false, result:err.toString(), close:true });
    });
}

function assemble(inputFile, outputDir) {
    const eventResult = [];
    const source = fs.readFileSync(inputFile, {encoding: 'utf8'});
    const assembled = krakatau.assemble(source);
    let nClass = 0;
    for (const [success, result] of assembled) {
        ++nClass;
        if (success) {
            let {name, data} = result;
            if (!name || name.length === 0) name = ('no_class_name_' + new Date().getTime());
            let outPath = path.resolve(outputDir, ...name.split('/')) + '.class';
            if (!pathIsInside(outPath,outputDir) || outPath.length > 255 )
                outPath = path.resolve(outputDir, path.basename(inputFile).replace(/\.j$/,'_CLASS_' + nClass)) + '.class';
            let folder = path.dirname(outPath);
            if (!fs.existsSync(folder)) mkdirP.sync(folder);
            fs.writeFileSync(outPath, data);
            eventResult.push({ success:true, name:name, outputFile:outPath });
        }
        else {
            const {error, notes} = result.args;
            const notesArray = [];
            notes.slice(0, 5).forEach(note => { notesArray.push(result.format(note)) });
            eventResult.push({ success:false, error: result.format(error), notes: notesArray });
        }
    }
    return eventResult;
}

function assembleFolder(inputDir, outputDir, recursive) {
    let total = 0;
    let classes = 0;
    traverseFolder(true, recursive, inputDir, (file)=> {
        let canContinue = true;
        if (file === null) postMessage({ success: true, close:true, total:total, classes:classes });
        else {
            if (file.endsWith('.j')) {
                ++total;
                let assembled = assemble(file, outputDir);
                assembled.forEach((cls)=> {
                    ++classes;
                    if (cls.success) {
                        postMessage({ success:true, result:cls.outputFile });
                    }
                    else {
                        postMessage({ success:false, result:file, error:cls.error, total:total, classes:classes });
                        canContinue = false;
                    }
                });
            }
        }
        return canContinue;
    });
}

function disassembleFolder(inputDir, outputDir, roundtrip, overwrite, recursive) {
    let total = 0;
    let errors = 0;
    try {
        traverseFolder(false, recursive, inputDir, (file)=> {
            if (file === null) postMessage({ success: true, close:true, total:total, errors:errors });
            else {
                if (file.endsWith('.class')) {
                    try {
                        const data = fs.readFileSync(file);
                        postMessage({ success:true, result:disassemble(data, file, outputDir, roundtrip, overwrite) });
                        ++total;
                    }
                    catch (e) {
                        ++errors;
                        postMessage({ success:false, result:e.toString(), file:file });
                    }
                }
            }
            return true;
        });
    }
    catch (e) {
        ++errors;
        postMessage({ success: false, close:true, result:e.toString(), total:total, errors:errors });
    }
}

function unjar(inputFile, outputDir) {
    const data = fs.readFileSync(inputFile);
    jszip.loadAsync(data).then((zip) => {
        let extractTasks = [];
        let total = 0;
        let processed = 0;
        Object.keys(zip.files).forEach((filename) => {
            if (!zip.files[filename].dir) { ++total; }
        });

        Object.keys(zip.files).forEach((filename) => {
            if (!zip.files[filename].dir) {
                extractTasks.push(new Promise((resolve, reject) => {
                    zip.files[filename].async('nodebuffer').then((content) => {
                        let dest = path.resolve(outputDir, filename);
                        let folder = path.dirname(dest);
                        if (!fs.existsSync(folder)) mkdirP.sync(folder);
                        fs.writeFileSync(dest, content);
                        ++processed;
                        postMessage({ success:true, result:dest, total:total, processed:processed });
                        resolve();
                    }).catch((err) => {
                        reject(err.toString());
                    });
                }));
            }
        });

        Promise.all(extractTasks).then(() => {
            postMessage({ success:true, result:inputFile, close:true });
        }).catch((err)=>{
            postMessage({ success:false, result:err.toString(), close:true });
        });

    }).catch((err) => {
        postMessage({ success:false, result:err.toString(), close:true });
    });
}

onmessage = (event) => {
    try {
        switch (event.data.op){
            case 'disassemble':
                const data = fs.readFileSync(event.data.inputFile);
                postMessage({ success:true, result:disassemble(data, event.data.inputFile, event.data.outputDir, event.data.roundtrip, event.data.overwrite) });
                break;
            case 'assemble':
                postMessage({ success:true, result:assemble(event.data.inputFile, event.data.outputDir) });
                break;
            case 'unjar':
                unjar(event.data.inputFile, event.data.outputDir);
                break;
            case 'disassembleJar':
                disassembleJar(event.data.inputFile, event.data.outputDir, event.data.roundtrip, event.data.overwrite);
                break;
            case 'assembleFolder':
                assembleFolder(event.data.inputDir, event.data.outputDir, event.data.recursive);
                break;
            case 'disassembleFolder':
                disassembleFolder(event.data.inputDir, event.data.outputDir, event.data.roundtrip, event.data.overwrite, event.data.recursive);
                break;
            default:
                postMessage({ success:false, result: `OP:${event.data.op} NOT SUPPORTED` });
        }
    }
    catch(e){
        if (debug) console.log(e);
        postMessage({ success:false, result: e.toString() });
    }

};

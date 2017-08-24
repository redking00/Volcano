const fs = require('fs');
const path = require('path');
const pathIsInside = require('../path-is-inside');
const krakatau = require('../krakatau');


function pathIsValid(path) {
    return /^([a-z]:\\|\/)[a-z0-9_]+[\\/a-z0-9_ .]*$/i.test(path);
}

function disassemble(inputFile, outputDir, roundtrip) {
    const data = fs.readFileSync(inputFile);
    const result = krakatau.disassemble(data, roundtrip);
    const clsName = result.name || ('no_class_name_' + new Date().getTime());
    let outPath = path.resolve(outputDir, ...clsName.split('/')) + '.j';
    if (!pathIsValid(outPath) || !pathIsInside(outPath,outputDir) || outPath.length > 255 )
        outPath = path.resolve(outputDir, path.basename(inputFile).replace(/\.class$/,'')) + '.j';
    fs.writeFileSync(outPath, result.data, {flag: "wx"});
    return outPath;
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
            if (!pathIsValid(outPath) || !pathIsInside(outPath,outputDir) || outPath.length > 255 )
                outPath = path.resolve(outputDir, path.basename(inputFile).replace(/\.j$/,'_CLASS_' + nClass)) + '.class';
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



onmessage = (event) => {
    try {
        switch (event.data.op){
            case 'disassemble':
                postMessage({ success:true, result:disassemble(event.data.inputFile, event.data.outputDir, event.data.roundtrip) });
                break;
            case 'assemble':
                postMessage({ success:true, result:assemble(event.data.inputFile, event.data.outputDir) });
                break;
            default:
                postMessage({ success:false, result: `OP:${event.data.op} NOT SUPPORTED` });
        }
    }
    catch(e){ postMessage({ success:false, result: e.toString() }); }

    close();
};

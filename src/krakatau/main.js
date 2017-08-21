// Copyright 2017 Robert Grosse
//
// This file is part of Krakatau.
//
// Krakatau is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Krakatau is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Krakatau. If not, see <http://www.gnu.org/licenses/>.

'use strict'

const {Reader} = require('./classfileformat/reader')
const {ClassData} = require('./classfileformat/classdata')
const {Disassembler} = require('./assembler/disassembly')
const parse = require('./assembler/parse')

function disassemble(data, roundtrip) {
    const clsdata = new ClassData(new Reader(data))
    let result = ''
    new Disassembler(clsdata, s => {result += s}, roundtrip).disassemble()
    return result
}

function assemble(source) {
    source = source.replace('\t', ' ') + '\n'
    return [...parse.assemble(source)]
}

module.exports = {assemble, disassemble}

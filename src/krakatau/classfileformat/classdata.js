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
const {int, range} = require('../std')
const {decode} = require('./mutf8')

const {Reader} = require('./reader')


const TAGS = [null, 'Utf8', null, 'Int', 'Float', 'Long', 'Double', 'Class', 'String', 'Field', 'Method', 'InterfaceMethod', 'NameAndType', null, null, 'MethodHandle', 'MethodType', null, 'InvokeDynamic']

const SlotData = (tag, data, refs) => Object.freeze({tag, data, refs})
const ExceptData = (start, end, handler, type) => Object.freeze({start, end, handler, type})

class ConstantPoolData {
    constructor(r) {
        this.slots = []
        this._null()
        const size = r.u16()
        while (this.slots.length < size) {
            this._const(r)
        }
    }

    _null() {
        this.slots.push(SlotData(null, null, null))
    }

    _const(r) {
        const t = TAGS[r.u8()]
        let data = null
        let refs = []

        switch (t) {
            case 'Utf8':
                data = decode(r.getRaw(r.u16())); break
            case 'Int':
            case 'Float':
                data = int(r.u32()); break
            case 'Long':
            case 'Double':
                data = r.u64(); break
            case 'MethodHandle':
                data = r.u8()
                refs.push(r.u16())
                break
            case 'Class':
            case 'String':
            case 'MethodType':
                refs.push(r.u16()); break
            default:
                refs.push(r.u16())
                refs.push(r.u16())
                break
        }

        this.slots.push(SlotData(t, data, refs))
        if (t === 'Long' || t === 'Double') {
            this._null()
        }
    }

    getutf(ind) {
        if (ind < this.slots.length && this.slots[ind].tag === 'Utf8') {
            return this.slots[ind].data
        }
    }

    getclsutf(ind) {
        if (ind < this.slots.length && this.slots[ind].tag === 'Class') {
            return this.getutf(this.slots[ind].refs[0])
        }
    }
}

class BootstrapMethodsData {
    constructor(r) {
        this.slots = []
        const n = r.u16()
        for (let i = 0; i < n; i++) {
            const [first, argcount] = [r.u16(), r.u16()]
            const refs = [first, ...Array.from(range(argcount), () => r.u16())]
            this.slots.push(SlotData('Bootstrap', null, refs))
        }
    }
}

class CodeData {
    constructor(r, pool, short) {
        var codelen
        if (short) {
            [this.stack, this.locals, codelen] = [r.u8(), r.u8(), r.u16()]
        } else {
            [this.stack, this.locals, codelen] = [r.u16(), r.u16(), r.u32()]
        }

        this.bytecode = r.getRaw(codelen)
        this.exceptions = Array.from(range(r.u16()), () => ExceptData(r.u16(), r.u16(), r.u16(), r.u16()))
        this.attributes = Array.from(range(r.u16()), () => new AttributeData(r))
    }
}

class AttributeData {
    constructor(r, pool=null) {
        console.assert(pool === null || pool instanceof ConstantPoolData)
        ;[this.name, this.length] = [r.u16(), r.u32()]

        var actual_length
        if (pool && pool.getutf(this.name) === 'InnerClasses') {
            actual_length = r.copy().u16() * 8 + 2
        } else {
            actual_length = this.length
        }

        this.raw = r.getRaw(actual_length)
        this.wronglength = actual_length != this.length
    }

    stream() {return new Reader(this.raw)}
}

class FieldData {
    constructor(r) {
        [this.access, this.name, this.desc] = [r.u16(), r.u16(), r.u16()]
        this.attributes = Array.from(range(r.u16()), () => new AttributeData(r))
    }
}

class MethodData {
    constructor(r) {
        [this.access, this.name, this.desc] = [r.u16(), r.u16(), r.u16()]
        this.attributes = Array.from(range(r.u16()), () => new AttributeData(r))
    }
}


class ClassData {
    constructor(r) {
        const [magic, minor, major] = [r.u32(), r.u16(), r.u16()]
        this.version = [major, minor]

        this.pool = new ConstantPoolData(r)

        ;[this.access, this.this, this.super] = [r.u16(), r.u16(), r.u16()]
        this.interfaces = Array.from(range(r.u16()), () => r.u16())
        this.fields = Array.from(range(r.u16()), () => new FieldData(r))
        this.methods = Array.from(range(r.u16()), () => new MethodData(r))
        this.attributes = Array.from(range(r.u16()), () => new AttributeData(r, this.pool))
    }

    *getattrs(name) {
        for (let attr of this.attributes) {
            if (this.pool.getutf(attr.name) === name) {
                yield attr
            }
        }
    }
}

module.exports = {ClassData, CodeData, BootstrapMethodsData}

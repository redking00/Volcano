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
const {Pool, utf} = require('./pool')
const {Writer, Label} = require('../classfileformat/writer')

function writeU16Count(data, error, objects, message) {
    const count = objects.length
    if (count >= 1<<16) {
        error(`Maximum ${message} count is ${0xFFFF}, found ${count}`, objects[count-1].tok)
    }
    data.u16(count)
}

class Code {
    constructor(tok, short) {
        this.tok = tok
        this.short = short
        this.locals = this.stack = 0

        this.bytecode = new Writer()
        this.exceptions = new Writer()
        this.exceptcount = 0

        this.stackdata = new Writer()
        this.stackcount = 0
        this.stackcountpos = this.stackdata.ph16()
        this.laststackoff = -1

        this.stackmaptable = null
        this.attributes = []

        this.labels = new Map()
        this.maxcodelen = short ? 0xFFFF : 0xFFFFFFFF
    }

    labeldef(lbl, error) {
        if (this.labels.has(lbl.sym)) {
            error('Duplicate label definition', lbl.tok,
                  'Previous definition here:', this.labels.get(lbl.sym).tok)
        }
        this.labels.set(lbl.sym, {tok: lbl.tok, pos: this.bytecode.pos})
    }

    catch(ref, fromlbl, tolbl, usinglbl) {
        this.exceptcount += 1
        this.exceptions.lbl(fromlbl, 0, 'u16')
        this.exceptions.lbl(tolbl, 0, 'u16')
        this.exceptions.lbl(usinglbl, 0, 'u16')
        this.exceptions.ref(ref)
    }

    assembleNoCP(data, error) {
        const bytecode = this.bytecode

        if (this.short) {
            data.u8(this.stack), data.u8(this.locals), data.u16(bytecode.pos)
        } else {
            data.u16(this.stack), data.u16(this.locals), data.u32(bytecode.pos)
        }
        data.addeq(bytecode)

        data.u16(this.exceptcount)
        data.addeq(this.exceptions)

        if (this.stackmaptable === null && this.stackcount > 0) {
            // Use arbitrary token in case we need to report errors
            this.stackmaptable = new Attribute(this.tok, 'StackMapTable')
            this.attributes.push(this.stackmaptable)
        }

        if (this.stackmaptable) {
            this.stackdata.setph16(this.stackcountpos, this.stackcount)
            this.stackmaptable.data = this.stackdata
        }

        writeU16Count(data, error, this.attributes, 'attribute')
        for (let attr of this.attributes) {
            attr.assembleNoCP(data, error)
        }
        return data.fillLabels(this.labels, error)
    }
}

class Attribute {
    constructor(tok, name, length=null) {
        console.assert(tok)

        if (typeof name === 'string') {
            name = utf(tok, Buffer.from(name))
        }

        this.tok = tok
        this.name = name
        this.length = length
        this.data = new Writer()
    }

    assembleNoCP(data, error) {
        const length = this.length === null ? this.data.pos : this.length
        if (length >= 0x100000000) {
            error(`Maximum attribute data length is ${0xFFFFFFFF} bytes, got ${length} bytes.`, this.tok)
        }

        data.ref(this.name)
        data.u32(length)
        data.addeq(this.data)
        return data
    }
}

class Method {
    constructor(tok, access, name, desc) {
        this.tok = tok
        this.access = access
        this.name = name
        this.desc = desc
        this.attributes = []
    }

    assembleNoCP(data, error) {
        data.u16(this.access)
        data.ref(this.name)
        data.ref(this.desc)

        writeU16Count(data, error, this.attributes, 'attribute')
        for (let attr of this.attributes) {
            attr.assembleNoCP(data, error)
        }
        return data
    }
}

class Field {
    constructor(tok, access, name, desc) {
        this.tok = tok
        this.access = access
        this.name = name
        this.desc = desc
        this.attributes = []
    }

    assembleNoCP(data, error) {
        data.u16(this.access)
        data.ref(this.name)
        data.ref(this.desc)

        writeU16Count(data, error, this.attributes, 'attribute')
        for (let attr of this.attributes) {
            attr.assembleNoCP(data, error)
        }
        return data
    }
}

class Class {
    constructor() {
        this.version = [49, 0]
        this.access = this.this = this.super = null

        this.interfaces = []
        this.fields = []
        this.methods = []
        this.attributes = []

        this.useshortcodeattrs = false
        this.bootstrapmethods = null
        this.pool = new Pool()
    }

    _getName() {
        const cpool = this.pool.cp
        const clsind = this.this.resolved_index
        if (!cpool.slots.get(clsind)) {
            return null
        }

        if (cpool.slots.get(clsind).type !== 'Class') {
            return null
        }

        const utfind = cpool.slots.get(clsind).refs[0].resolved_index
        if (!cpool.slots.has(utfind)) {
            return null
        }

        return cpool.slots.get(utfind).data
    }

    _assembleNoCP(error) {
        const beforepool = new Writer()
        const afterpool = new Writer()

        beforepool.u32(0xCAFEBABE)
        beforepool.u16(this.version[1])
        beforepool.u16(this.version[0])

        afterpool.u16(this.access)
        afterpool.ref(this.this)
        afterpool.ref(this.super)
        writeU16Count(afterpool, error, this.interfaces, 'interface')
        for (let i of this.interfaces) {
            afterpool.ref(i)
        }

        writeU16Count(afterpool, error, this.fields, 'field')
        for (let field of this.fields) {
            field.assembleNoCP(afterpool, error)
        }

        writeU16Count(afterpool, error, this.methods, 'method')
        for (let method of this.methods) {
            method.assembleNoCP(afterpool, error)
        }

        const attrcountpos = afterpool.ph16()
        const afterbs = new Writer()

        let data = afterpool
        for (let attr of this.attributes) {
            if (attr === this.bootstrapmethods) {
                data = afterbs
            } else {
                attr.assembleNoCP(data, error)
            }
        }

        return {beforepool, afterpool, afterbs, attrcountpos}
    }

    assemble(error) {
        const {beforepool, afterpool, afterbs, attrcountpos} = this._assembleNoCP(error)

        this.pool.cp.freezedefs()
        this.pool.bs.freezedefs()

        for (let {pos, ref} of afterpool.refu8phs) {
            const ind = ref.resolve(this.pool, error)
            if (ind >= 256) {
                error("Ldc references too many distinct constants in this class. If you don't want to see this message again, use ldc_w instead of ldc everywhere.", ref.tok)
            }
        }

        beforepool.fillRefs(this.pool, error)
        afterpool.fillRefs(this.pool, error)
        afterbs.fillRefs(this.pool, error)

        this.pool.resolveIDBSRefs(error)
        if (this.bootstrapmethods === null && this.pool.bs.slots.size > 0) {
            console.assert(afterbs.pos === 0)

            this.bootstrapmethods = new Attribute(this.this.tok, 'BootstrapMethods')
            this.attributes.push(this.bootstrapmethods)
        }

        if (this.bootstrapmethods !== null) {
            this.bootstrapmethods.name.resolve(this.pool, error)
        }

        if (this.attributes.length >= 1<<16) {
            error(`Maximum class attribute count is 65535, found ${this.attributes.length}.`, this.attributes[this.attributes.length-1].tok)
        }
        afterpool.setph16(attrcountpos, this.attributes.length)

        const {cpdata, bsmdata} = this.pool.write(error)

        const data = beforepool
        data.addeq(cpdata)
        data.addeq(afterpool)

        if (this.bootstrapmethods !== null) {
            this.bootstrapmethods.data = bsmdata
            this.bootstrapmethods.assembleNoCP(data, error)
            data.fillRefs(this.pool, error)
            data.addeq(afterbs)
        }

        const name = this._getName()
        if (name === null) {
            error('Invalid reference for class name.', this.this.tok)
        }
        return {name, data: data.toBytes()}
    }
}

module.exports = {Code, Attribute, Field, Method, Class, Label}

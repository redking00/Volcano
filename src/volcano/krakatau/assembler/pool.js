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
const {M32, int, range} = require('../std')

const {Writer} = require('../classfileformat/writer')

const TAGS = [null, 'Utf8', null, 'Int', 'Float', 'Long', 'Double', 'Class', 'String', 'Field', 'Method', 'InterfaceMethod', 'NameAndType', null, null, 'MethodHandle', 'MethodType', null, 'InvokeDynamic']

class Ref {
    constructor(tok, {index=null, symbol=null, type=null, refs=null, data=null, isbs=false} = {}) {
        this.tok = tok
        this.isbs = isbs
        this.index = index
        this.symbol = symbol

        this.type = type
        this.refs = refs || []
        this.data = data

        this.resolved_index = null
        console.assert(typeof tok.val === 'string' && typeof tok.pos === 'number')
        if (data instanceof int) {
            console.assert(data.geq(0))
            console.assert(data.shiftRight(64) == 0)

        }
        for (let ref of this.refs) {
            console.assert(ref instanceof Ref)
        }
        // console.log('created ref', type, data)
    }

    israw() {return this.index !== null}
    issym() {return this.symbol !== null}

    _deepdata(pool, error, defstack=[]) {
        if (this.issym()) {
            return pool.sub(this).getroot(this, error)._deepdata(pool, error, defstack)
        }

        if (this.israw()) {
            return pool.intern('Raw', this.index)
        }

        if (defstack.length > 5) {
            const error_args = ['Constant pool definitions cannot be nested more than 5 deep (excluding raw references).', this.tok]
            for (let {type, tok} of defstack.slice().reverse()) {
                error_args.push(`Included from ${type} here:`)
                error_args.push(tok)
            }
            error(...error_args)
        }

        const ref_datas = Array.from(this.refs, ref => ref._deepdata(pool, error, [...defstack, this]))
        let result = null
        while (ref_datas.length > 0) {
            result = pool.intern(ref_datas.pop(), result)
        }

        let data_key = this.data
        if (this.data instanceof Buffer) {
            data_key = data_key.toString('latin1')
        } else if (this.data instanceof int) {
            data_key = data_key.toString()
        }

        return pool.intern(this.type, pool.intern(data_key, result))
    }

    _resolve(pool, error) {
        if (this.israw()) {
            return this.index
        } else if (this.issym()) {
            return pool.sub(this).getroot(this, error).resolve(pool, error)
        } else {
            return pool.sub(this).resolvedata(this, error, this._deepdata(pool, error))
        }
    }

    resolve(pool, error) {
        if (this.resolved_index === null) {
            this.resolved_index = this._resolve(pool, error)
            console.assert(this.resolved_index !== null)
        }
        return this.resolved_index
    }
}

function utf(tok, s) {
    console.assert(s instanceof Buffer)
    console.assert(s.length <= 65535)
    return new Ref(tok, {type: 'Utf8', data: s})
}

function single(type, tok, s) {
    console.assert('Class String MethodType'.includes(type))
    return new Ref(tok, {type, refs: [utf(tok, s)]})
}

function nat(name, desc) {
    return new Ref(name.tok, {type: 'NameAndType', refs: [name, desc]})
}

function primitive(type, tok, x) {
    console.assert('Int Long Float Double'.includes(type))
    console.assert(x instanceof int)
    return new Ref(tok, {type, data: x})
}

class PoolSub {
    constructor(isbs) {
        this.isbs = isbs
        this.symdefs = new Map()
        this.symrootdefs = new Map()
        this.slot_def_tokens = new Map()
        this.slots = new Map()

        this.dataToSlot = new Map()
        this.narrowcounter = range(0, 65535)
        this.widecounter = range(0, 65534)

        this.dirtyslotdefs = []
        this.defsfrozen = false
        if (!isbs) {
            this.slots.set(0, null)
        }
    }

    adddef(lhs, rhs, error) {
        console.assert(!this.defsfrozen)
        console.assert(lhs.israw() || lhs.issym())
        console.assert(this.isbs === (rhs.type === 'Bootstrap'))

        if (lhs.israw()) {
            if (lhs.index === 0 && !this.isbs) {
                error('Constant pool index must be nonzero', lhs.tok)
            }

            if (this.slots.has(lhs.index)) {
                error('Conflicting raw reference definition', lhs.tok,
                      'Conflicts with previous definition:', this.slot_def_tokens.get(lhs.index))
            }

            this.slots.set(lhs.index, rhs)
            this.slot_def_tokens.set(lhs.index, lhs.tok)
            this.dirtyslotdefs.push(lhs.index)
            console.assert(rhs.type)
            if (rhs.type === 'Long' || rhs.type === 'Double') {
                if (this.slots.has(lhs.index + 1)) {
                    error('Conflicting raw reference definition', lhs.tok,
                          'Conflicts with previous definition:', this.slot_def_tokens.get(lhs.index + 1))
                }
                this.slots.set(lhs.index + 1, null)
                this.slot_def_tokens.set(lhs.index + 1, lhs.tok)
            }
        } else {
            if (this.symdefs.has(lhs.symbol)) {
                error('Duplicate symbolic reference definition', lhs.tok,
                      'Previously defined here:', this.symdefs.get(lhs.symbol)[0])
            }
            this.symdefs.set(lhs.symbol, [lhs.tok, rhs])
        }
    }

    freezedefs() {this.defsfrozen = true}

    _getslot(iswide) {
        console.assert(this.defsfrozen)
        let ind, done
        if (iswide) {
            ;({done, value: ind} = this.widecounter.next())
            while (!done && this.slots.has(ind) || this.slots.has(ind + 1)) {
                ;({done, value: ind} = this.widecounter.next())
            }
            if (done) {
                return null
            }
        } else {
            ;({done, value: ind} = this.narrowcounter.next())
            while (!done && this.slots.has(ind)) {
                ;({done, value: ind} = this.narrowcounter.next())
            }
            if (done) {
                return null
            }
        }
        console.assert(ind < 0xFFFF)
        return ind
    }

    getroot(ref, error) {
        console.assert(this.defsfrozen && ref.issym())
        if (this.symrootdefs.has(ref.symbol)) {
            return this.symrootdefs.get(ref.symbol)
        }

        let stack = []
        let visited = new Set()
        while (ref.issym()) {
            const sym = ref.symbol
            if (visited.has(sym)) {
                let error_args = ['Circular symbolic reference', ref.tok]
                for (let tok of stack.reverse()) {
                    error_args.push('Included from here:')
                    error_args.push(tok)
                }
                error(...error_args)
            }
            stack.push(ref.tok)
            visited.add(sym)

            if (!this.symdefs.has(sym)) {
                error('Undefined symbolic reference', ref.tok)
            }
            ref = this.symdefs.get(sym)[1]
        }

        for (let sym of visited) {
            this.symrootdefs.set(sym, ref)
        }
        return ref
    }

    resolvedata(ref, error, newdata) {
        if (this.dataToSlot.has(newdata)) {
            return this.dataToSlot.get(newdata)
        }

        const iswide = newdata[0] === 'Long' || newdata[0] === 'Double'
        const slot = this._getslot(iswide)
        if (slot === null) {
            const name = ref.isbs ? 'bootstrap method' : 'constant pool'
            error(`Exhausted ${name} space.`, ref.tok)
        }

        this.dataToSlot.set(newdata, slot)
        this.slots.set(slot, ref)
        this.dirtyslotdefs.push(slot)
        if (iswide) {
            this.slots.set(slot + 1, null)
        }
        return slot
    }

    resolveslotrefs(pool, error) {
        while (this.dirtyslotdefs.length > 0) {
            const i = this.dirtyslotdefs.pop()
            for (let ref of this.slots.get(i).refs) {
                ref.resolve(pool, error)
            }
        }
    }

    writeconst(w, ref, pool, error) {
        const t = ref.type
        w.u8(TAGS.indexOf(t))
        switch (t) {
            case 'Utf8':
                w.u16(ref.data.length)
                w.writeBytes(ref.data)
                break
            case 'Int':
            case 'Float':
                w.u32(ref.data.valueOf())
                break
            case 'Long':
            case 'Double':
                w.u32(ref.data.shiftRight(32).valueOf())
                w.u32(ref.data.mod(M32).valueOf())
                break
            case 'MethodHandle':
                w.u8(ref.data)
                w.u16(ref.refs[0].resolve(pool, error))
                break
            default:
                for (let child of ref.refs) {
                    w.u16(child.resolve(pool, error))
                }
        }
        return w
    }

    writebootstrap(w, ref, pool, error) {
        console.assert(ref.type === 'Bootstrap')
        w.u16(ref.refs[0].resolve(pool, error))
        w.u16(ref.refs.length-1)
        for (let child of ref.refs.slice(1)) {
            w.u16(child.resolve(pool, error))
        }
        return w
    }

    write(pool, error) {
        this.resolveslotrefs(pool, error)
        this.dirtyslotdefs = null

        const size = this.slots.size ? Math.max(...this.slots.keys()) + 1 : 0
        let dummyenttry = Buffer.from([1,0,0]) // empty UTF8
        if (this.isbs && this.slots.size) {
            const [first] = [...this.slots.values()]
            dummyenttry = this.writebootstrap(new Writer(), first, pool, error).toBytes()
        }

        const w = new Writer()
        w.u16(size)
        for (let i of range(size)) {
            if (!this.slots.has(i)) {
                w.writeBytes(dummyenttry)
                continue
            }

            const v = this.slots.get(i)
            console.assert(v === null || v instanceof Ref)
            if (v === null) {
                continue
            }

            if (this.isbs) {
                this.writebootstrap(w, v, pool, error)
                if (w.pos >= 0x100000000) {
                    error(`Maximum BootstrapMethods length is ${0xFFFFFFFF} bytes.`, v.tok)
                }
            } else {
                this.writeconst(w, v, pool, error)
            }
        }

        return w
    }
}

class Pool {
    constructor() {
        this.cp = new PoolSub(false)
        this.bs = new PoolSub(true)

        this.interned = new Map()
        this.debug_intern = new WeakSet()
    }

    sub(ref) {return ref.isbs ? this.bs : this.cp}

    intern(lhs, rhs) {
        // if (typeof rhs === 'object' && !this.debug_intern.has(rhs)) {
        //     debugger;
        // }
        console.assert(typeof lhs !== 'object' || lhs === null || this.debug_intern.has(lhs))
        console.assert(typeof rhs !== 'object' || rhs === null  || this.debug_intern.has(rhs))

        if (!this.interned.has(lhs)) {
            this.interned.set(lhs, new Map())
        }

        const d = this.interned.get(lhs)
        if (!d.has(rhs)) {
            d.set(rhs, [lhs, rhs])
            this.debug_intern.add(d.get(rhs))
        }
        return d.get(rhs)
    }


    resolveIDBSRefs(error) {
        for (let v of this.cp.slots.values()) {
            if (v !== null && v.type === 'InvokeDynamic') {
                v.refs[0].resolve(this, error)
            }
        }
    }

    write(error) {
        const bsmdata = this.bs.write(this, error)
        const cpdata = this.cp.write(this, error)
        return {cpdata, bsmdata}
    }
}

module.exports = {Pool, Ref, utf, single, nat, primitive}

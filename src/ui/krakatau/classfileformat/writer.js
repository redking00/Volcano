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
const {mod} = require('../std')

const Label = (tok, sym) => Object.freeze({tok, sym})

class Writer {
    constructor() {
        this.alloc = Buffer.alloc(32)
        this.buf = this.alloc.slice(0, 0)

        this.refphs = []
        this.refu8phs = []
        this.lblphs = []

        this._ph8s = new Set()
        this._ph16s = new Set()
        this._ph32s = new Set()
    }

    _reserve(n) {
        const oldlen = this.buf.length
        const newlen = oldlen + n
        if (newlen > this.alloc.length) {
            this.alloc = Buffer.alloc(Math.max(this.alloc.length * 2, newlen))
            this.buf.copy(this.alloc)
        }
        this.buf = this.alloc.slice(0, newlen)
        return oldlen
    }

    get pos() {return this.buf.length}

    u8(x) {const pos = this._reserve(1); this.buf.writeUInt8(x, pos)}
    s8(x) {const pos = this._reserve(1); this.buf.writeInt8(x, pos)}
    u16(x) {const pos = this._reserve(2); this.buf.writeUInt16BE(x, pos)}
    s16(x) {const pos = this._reserve(2); this.buf.writeInt16BE(x, pos)}
    u32(x) {const pos = this._reserve(4); this.buf.writeUInt32BE(x, pos)}
    s32(x) {const pos = this._reserve(4); this.buf.writeInt32BE(x, pos)}

    writeBytes(buf) {
        const pos = this.pos
        this._reserve(buf.length)
        buf.copy(this.buf, pos)
    }

    ref(ref) {
        this.refphs.push({pos: this.pos, ref})
        this.u16(0)
    }

    refu8(ref) {
        this.refu8phs.push({pos: this.pos, ref})
        this.u8(0)
    }

    ph8() {
        const pos = this.pos
        this.u8(0)
        this._ph8s.add(pos)
        return pos
    }

    ph16() {
        const pos = this.pos
        this.u16(0)
        this._ph16s.add(pos)
        return pos
    }

    ph32() {
        const pos = this.pos
        this.u32(0)
        this._ph32s.add(pos)
        return pos
    }

    lbl(lbl, base, dtype) {
        console.assert(lbl.tok)
        const pos = dtype === 's32' ? this.ph32() : this.ph16()
        this.lblphs.push({pos, lbl, base, dtype})
    }

    lblrange(start, end) {
        this.lbl(start, 0, 'u16')
        this.lbl(end, start, 'u16')
    }

    setph8(pos, x) {
        console.assert(this.buf[pos] === 0 && this._ph8s.has(pos))
        this.buf.writeUInt8(x, pos)
        this._ph8s.delete(pos)
    }

    setph16(pos, x) {
        console.assert(this.buf[pos] === 0 && this._ph16s.has(pos))
        this.buf.writeUInt16BE(x, pos)
        this._ph16s.delete(pos)
    }

    setph32(pos, x) {
        console.assert(this.buf[pos] === 0 && this._ph32s.has(pos))
        this.buf.writeUInt32BE(x, pos)
        this._ph32s.delete(pos)
    }

    _getlbl(lbl, labels, error) {
        if (!labels.has(lbl.sym)) {
            error('Undefined label', lbl.tok)
        }
        return labels.get(lbl.sym).pos
    }

    fillLabels(labels, error) {
        for (let {pos, lbl, base, dtype} of this.lblphs) {
            const tok = lbl.tok
            lbl = this._getlbl(lbl, labels, error)

            // base can also be a second label
            if (typeof base !== 'number') {
                base = this._getlbl(base, labels, error)
            }

            const offset = lbl - base
            switch (dtype) {
                case 's16':
                    if (offset < -1<<15 || offset >= 1<<15) {
                        error(`Label offset must fit in signed 16 bit int. (offset is ${offset})`, tok)
                    }
                    this.setph16(pos, mod(offset, 1<<16))
                    break
                case 'u16':
                    if (offset < 0 || offset >= 1<<16) {
                        error(`Label offset must fit in unsigned 16 bit int. (offset is ${offset})`, tok)
                    }
                    this.setph16(pos, mod(offset, 1<<16))
                    break
                case 's32':
                    if (offset < -1<<31 || offset >= 0x80000000) {
                        error(`Label offset must fit in signed 32 bit int. (offset is ${offset})`, tok)
                    }
                    this.setph32(pos, mod(offset, 0x100000000))
                    break
                default:
                    console.assert(0)
            }
        }
        this.lblphs = []
        return this
    }

    fillRefs(pool, error) {
        for (let {pos, ref} of this.refu8phs) {
            this.buf.writeUInt8(ref.resolve(pool, error), pos)
        }
        for (let {pos, ref} of this.refphs) {
            this.buf.writeUInt16BE(ref.resolve(pool, error), pos)
        }
        this.refu8phs = []
        this.refphs = []
    }

    toBytes() {
        console.assert(!this.refphs.length && !this.refu8phs.length)
        console.assert(!(this._ph8s.size + this._ph16s.size + this._ph32s.size))
        return this.buf
    }

    addeq(other) {
        console.assert(other.lblphs.length === other._ph8s.size + other._ph16s.size + other._ph32s.size)

        const offset = this.pos
        this.writeBytes(other.buf)
        this.refphs = [...this.refphs, ...other.refphs.map(({pos, ref}) => ({pos: pos+offset, ref}))]
        this.refu8phs = [...this.refu8phs, ...other.refu8phs.map(({pos, ref}) => ({pos: pos+offset, ref}))]
        this.lblphs = [...this.lblphs, ...other.lblphs.map(({pos, lbl, base, dtype}) => ({pos: pos+offset, lbl, base, dtype}))]

        other._ph8s.forEach(pos => this._ph8s.add(pos + offset))
        other._ph16s.forEach(pos => this._ph16s.add(pos + offset))
        other._ph32s.forEach(pos => this._ph32s.add(pos + offset))
        return this
    }
}

module.exports = {Writer, Label}

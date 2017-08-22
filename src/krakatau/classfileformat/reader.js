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
const {wordsToU64} = require('../std')

class Reader {
    constructor(data, off=0) {
        this.d = data
        this.off = off
    }

    offset(n) {
        let old = this.off
        this.off += n
        return old
    }

    done() {return this.off >= this.d.length}
    copy() {return new Reader(this.d, this.off)}

    u8() {return this.d.readUInt8(this.offset(1))}
    s8() {return this.d.readInt8(this.offset(1))}
    u16() {return this.d.readUInt16BE(this.offset(2))}
    s16() {return this.d.readInt16BE(this.offset(2))}
    u32() {return this.d.readUInt32BE(this.offset(4))}
    s32() {return this.d.readInt32BE(this.offset(4))}

    u64() {return wordsToU64(this.u32(), this.u32())}

    getRaw(n) {return this.d.slice(this.offset(n), this.off)}
    size() {return this.d.length - this.off}
}

module.exports = {Reader}

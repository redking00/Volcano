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

function encode(s) {
    const bytes = []

    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        if (c > 0 && c < 128) {
            bytes.push(c)
        } else if (c < 0x800) {
            bytes.push(0b11000000 | (c >> 6))
            bytes.push(0b10000000 | (c & 63))
        } else {
            bytes.push(0b11100000 | (c >> 12))
            bytes.push(0b10000000 | ((c >> 6) & 63))
            bytes.push(0b10000000 | (c & 63))
        }
    }

    return Buffer.from(bytes)
}

function decode(b) {
    const codes = []
    for (let i = 0; i < b.length; i++) {
        let x = b[i]
        if (x >= 0b11100000) {
            const y = b[++i]
            const z = b[++i]
            x = (x & 15) << 12 | (y & 63) << 6 | (z & 63)
        } else if (x >= 0b11000000) {
            const y = b[++i]
            x = (x & 31) << 6 | (y & 63)
        }

        codes.push(x)
    }

    return String.fromCharCode(...codes)
}

module.exports = {encode, decode}

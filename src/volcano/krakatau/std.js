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
const int = require('../BigInteger/BigInteger.min');

const INTS = {
    M32: int(1).shiftLeft(32),
    M64: int(1).shiftLeft(64),

    INT_MIN: int(-1).shiftLeft(31),
    INT_MAX: int(1).shiftLeft(31).minus(1),
    UINT_MAX: int(1).shiftLeft(32).minus(1),
    LONG_MIN: int(-1).shiftLeft(63),
    LONG_MAX: int(1).shiftLeft(63).minus(1),
    ULONG_MAX: int(1).shiftLeft(64).minus(1),
}

const M32 = INTS.M32
const wordsToU64 = (hi, low) => M32.times(hi).plus(low)

function* range(start, end) {
    if (end === undefined) {
        end = start
        start = 0
    }

    for (let i = start; i < end; i++) {
        yield i
    }
}

function* zip(iter1, iter2) {
    iter1 = iter1[Symbol.iterator]()
    iter2 = iter2[Symbol.iterator]()

    while (1) {
        const {done: d1, value: v1} = iter1.next()
        const {done: d2, value: v2} = iter2.next()
        if (d1 || d2) {
            return
        } else {
            yield [v1, v2]
        }
    }
}

function mod(val, m) {
    return ((val % m) + m) % m
}

const toChars = s => Array.from(s, c => c.charCodeAt(0))

module.exports = {int, INTS, M32, wordsToU64, range, zip, mod, toChars}

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
const _pairs = [
    ['public', 0x0001],
    ['private', 0x0002],
    ['protected', 0x0004],
    ['static', 0x0008],
    ['final', 0x0010],
    ['super', 0x0020],
    ['synchronized', 0x0020],
    ['volatile', 0x0040],
    ['bridge', 0x0040],
    ['transient', 0x0080],
    ['varargs', 0x0080],
    ['native', 0x0100],
    ['interface', 0x0200],
    ['abstract', 0x0400],
    ['strict', 0x0800],
    ['synthetic', 0x1000],
    ['annotation', 0x2000],
    ['enum', 0x4000],
    ['mandated', 0x8000],
]

const FLAGS = new Map(_pairs)
const RFLAGS_M = new Map(Array.from(_pairs, ([k, v]) => [v, k]))
const RFLAGS = new Map(Array.from(_pairs.slice().reverse(), ([k, v]) => [v, k]))
// Treat strictfp as flag too to reduce confusion
FLAGS.set('strictfp', FLAGS.get('strict'))

module.exports = {FLAGS, RFLAGS_M, RFLAGS}

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
const {range, zip, toChars} = require('../std')

const _handle_types = 'getField getStatic putField putStatic invokeVirtual invokeStatic invokeSpecial newInvokeSpecial invokeInterface'.split(' ')
const handle_codes = new Map(zip(_handle_types, range(1,10)))
const handle_rcodes = new Map(Array.from(handle_codes, ([k, v]) => [v, k]))


const newarr_rcodes = [null, null, null, null, ...'boolean char float double byte short int long'.split(' ')]
const newarr_codes = new Map(zip('boolean char float double byte short int long'.split(' '), range(4,12)))

const vt_rcodes = ['Top','Integer','Float','Double','Long','Null','UninitializedThis','Object','Uninitialized']
const vt_codes = new Map(Array.from(vt_rcodes, (k, i) => [k, i]))

const et_rtags = new Map(zip(toChars('BCDFIJSZsec@['), 'byte char double float int long short boolean string enum class annotation array'.split(' ')))
const et_tags = new Map(Array.from(et_rtags, ([k, v]) => [v, k]))

module.exports = {handle_codes, handle_rcodes, newarr_rcodes, newarr_codes, vt_rcodes, vt_codes, et_rtags, et_tags}



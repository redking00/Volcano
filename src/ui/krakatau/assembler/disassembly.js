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
const toFloat64 = require('../deps/math-float64-from-words/lib/index.js');
const toFloat32 = require('../deps/math-float32-from-word/lib/index.js');

const {int, range, M31, M32, M63, M64} = require('../std')

const classdata = require('../classfileformat/classdata')
const mutf8 = require('../classfileformat/mutf8')
const {Reader} = require('../classfileformat/reader')
const {thunk} = require('../util/thunk')

const codes = require('./codes')
const token_regexes = require('./token_regexes')
const {FLAGS, RFLAGS, RFLAGS_M} = require('./flags')
const {OPNAMES, OP_CLS, OP_FMIM, OP_LBL, OP_NONE, OP_SHORT} = require('./instructions')

const MAX_INLINE_SIZE = 300
const MAX_INDENT = 20
const WORD_REGEX = new RegExp(token_regexes.WORD + '$')

const PREFIXES = {'Utf8': 'u', 'Class': 'c', 'String': 's', 'Field': 'f', 'Method': 'm', 'InterfaceMethod': 'im', 'NameAndType': 'nat', 'MethodHandle': 'mh', 'MethodType': 'mt', 'InvokeDynamic': 'id'}

function reprbytes(buf) {
    return 'b' + repr_unicode(buf.toString('latin1'))
}

function repr_unicode(s) {
    const ESCAPES = {
        '\n': 'n',
        '\t': 't',
        '\r': 'r',
        '\\': '\\',
    }

    const sep = (s.includes("'") && !s.includes('"')) ? '"' : "'"
    let r = sep
    for (let c of s.split('')) {
        if (c === sep) {
            r += '\\' + c
        } else if (ESCAPES[c]) {
            r += '\\' + ESCAPES[c]
        } else if (c >= ' ' && c < '\u007f') {
            r += c
        } else if (c < '\u0100') {
            const temp = c.charCodeAt(0).toString(16)
            r += '\\x' + '0'.repeat(2 - temp.length) + temp
        } else {
            const temp = c.charCodeAt(0).toString(16)
            r += '\\u' + '0'.repeat(4 - temp.length) + temp
        }
    }
    return r + sep
}

function isword(s) {
    return s.search(WORD_REGEX) === 0 && !FLAGS.has(s)
}

function format_string(s) {
    const buf = mutf8.encode(s)
    if (mutf8.decode(buf) === s) {
        return repr_unicode(s)
    }
    return reprbytes(buf)
}

function make_signed(x, bits) {
    if (x.geq(int(1).shiftLeft(bits - 1))) {
        x = x.minus(int(1).shiftLeft(bits))
    }
    return x
}



class StackMapReader {
    constructor() {
        this.stream = null
        this.tag = -1
        this.pos = -1
        this.count = 0
    }

    setdata(r) {
        console.assert(this.stream === null)
        this.stream = r
        this.count = r.u16() + 1
        this.parseNextPos()
    }

    parseNextPos() {
        this.count -= 1
        if (this.count > 0) {
            const r = this.stream
            this.tag = r.u8()

            var delta
            if (this.tag <= 127) { // same and stack_1
                delta = this.tag % 64
            } else { // everything else has 16bit delta field
                delta = r.u16()
            }
            this.pos += delta + 1
        }
    }
}

class ReferencePrinter {
    constructor(clsdata, roundtrip) {
        this.roundtrip = roundtrip

        this.cpslots = clsdata.pool.slots
        this.bsslots = []
        for (let attr of clsdata.getattrs('BootstrapMethods')) {
            this.bsslots = new classdata.BootstrapMethodsData(attr.stream()).slots
            break
        }

        // CP index 0 should always be this raw reference. Additionally, there is one case where exact
        // references are significant due to this bug in the JVM. In the InnerClasses attribute,
        // specifying the same index for inner and outer class will fail verification, but specifying
        // different indexes which point to identical class entries will pass. In this case, we force
        // references to those indexes to be raw, so they don't get merged and break the class.
        this.forcedraw = new Set([0])
        for (let attr of clsdata.getattrs('InnerClasses')) {
            const r = attr.stream()
            for (let _ of range(r.u16())) {
                const [inner, outer] = [r.u16(), r.u16(), r.u16(), r.u16()]
                if (inner !== outer && clsdata.pool.getclsutf(inner) === clsdata.pool.getclsutf(outer)) {
                    this.forcedraw.add(inner)
                    this.forcedraw.add(outer)
                }
            }
        }

        this.used_cp = new Set()
        this.used_bs = new Set()
        this.encoded = new Map()
        this.utfcounts = new Map()
    }

    _float_or_double(x, isdouble) {
        const suffix = isdouble ? '' : 'f'

        if (this.roundtrip) {
            const emask = isdouble ? 0x7FF : 0xFF
            const num_ebits = isdouble ? 11 : 8
            const num_mbits = isdouble ? 52 : 23

            const sbit = x.shiftRight(num_mbits + num_ebits) & 1
            const ebits = x.shiftRight(num_mbits) & emask
            const mbits = x.mod(int(1).shiftLeft(num_mbits))

            let result
            if (ebits === emask) {
                if (mbits.isZero()) {
                    result = 'Infinity'
                } else {
                    const expected_length = isdouble ? 16 : 8
                    let hex = x.toString(16).toUpperCase()
                    // Node doesn't appear to support String.padStart() yet
                    hex = '0'.repeat(expected_length - hex.length) + hex
                    result = `NaN<0x${hex}>`
                }
            } else if (ebits === 0 && mbits.isZero()) {
                result = '0.0'
            } else {
                const ebias = emask >> 1
                let exponent = ebits - ebias - num_mbits
                let mantissa = mbits
                if (ebits > 0) {
                    mantissa = mantissa.plus(int(1).shiftLeft(num_mbits))
                } else {
                    exponent += 1
                }

                result = `0x${mantissa.toString(16).toUpperCase()}p${exponent}`
            }
            return '+-'[sbit] + result + suffix
        } else {
            let f
            if (isdouble) {
                const high = x.shiftRight(32)
                const low = x.mod(M32)
                f = toFloat64(high.valueOf(), low.valueOf())
            } else {
                f = toFloat32(x.valueOf())
            }

            let s = f.toString();

            // hack to make printing more like Python:
            // If exponent is negative and single digit, add leading 0 to exponent
            if (/e-\d$/.test(s)) {
                s = s.slice(0, -1) + '0' + s.slice(-1)
            }


            // Handle negative zero specially, since toString() returns '0'
            if (f === 0 && !x.isZero()) {
                s = '-0.0'
            }
            if (Number.isFinite(f) && !s.includes('.') && !s.includes('e')) {
                s += '.0'
            }
            if (s[0] != '-') {
                s = '+' + s
            }
            return s + suffix
        }
    }

    _float(x) {return this._float_or_double(x, false)}
    _double(x) {return this._float_or_double(x, true)}
    _int(x) {return make_signed(x, 32).toString()}
    _long(x) {return make_signed(x, 64).toString() + 'L'}

    _encode_utf(ind, wordok=true) {
        let pair = this.encoded.get(ind)
        if (!pair) {
            const data = this.cpslots[ind].data
            const string = format_string(data)
            const word = isword(data) ? data : string
            pair = [string, word]
            this.encoded.set(ind, pair)
        }
        return wordok ? pair[1] : pair[0]
    }

    rawref(ind, isbs=false) {
        return isbs ? `[bs:${ind}]` : `[${ind}]`
    }

    symref(ind, isbs=false) {
        ;(isbs ? this.used_bs : this.used_cp).add(ind)

        if (isbs) {
            return `[bs:_${ind}]`
        }

        const prefix = PREFIXES[this.cpslots[ind].tag] || '_'
        return `[${prefix}${ind}]`
    }

    ref(ind, isbs=false) {
        if (this.roundtrip || (!isbs && this.forcedraw.has(ind))) {
            return this.rawref(ind, isbs)
        }
        return this.symref(ind, isbs)
    }

    _ident(ind, wordok=true) {
        // console.log(ind, this.cpslots.length, this.cpslots[ind])
        if (this.cpslots[ind].tag === 'Utf8') {
            const val = this._encode_utf(ind, wordok)
            if (val.length < MAX_INLINE_SIZE) {
                if (val.length < 50 || (this.utfcounts.get(ind) || 0) < 10) {
                    this.utfcounts.set(ind, 1 + (this.utfcounts.get(ind) || 0))
                    return val
                }
            }
        }
        return null
    }

    utfref(ind) {
        if (this.roundtrip || this.forcedraw.has(ind)) {
            return this.rawref(ind)
        }
        const temp = this._ident(ind)
        if (temp !== null) {
            return temp
        }
        return this.symref(ind)
    }

    clsref(ind) {
        console.assert(Number.isInteger(ind))
        if (this.roundtrip || this.forcedraw.has(ind)) {
            return this.rawref(ind)
        }
        if (this.cpslots[ind].tag === 'Class') {
            const ind2 = this.cpslots[ind].refs[0]
            const temp = this._ident(ind2)
            if (temp !== null) {
                return temp
            }
        }
        return this.symref(ind)
    }

    natref(ind) {
        if (this.roundtrip || this.forcedraw.has(ind)) {
            return this.rawref(ind)
        }
        if (this.cpslots[ind].tag === 'NameAndType') {
            const [ind2, ind3] = this.cpslots[ind].refs
            const temp = this._ident(ind2)
            if (temp !== null) {
                return temp + ' ' + this.utfref(ind3)
            }
        }
        return this.symref(ind)
    }

    fmimref(ind) {
        if (this.roundtrip || this.forcedraw.has(ind)) {
            return this.rawref(ind)
        }
        if (['Field', 'Method', 'InterfaceMethod'].includes(this.cpslots[ind].tag)) {
            const [ind2, ind3] = this.cpslots[ind].refs
            return [this.cpslots[ind].tag, this.clsref(ind2), this.natref(ind3)].join(' ')
        }
        return this.symref(ind)
    }

    mhnotref(ind) {
        const slot = this.cpslots[ind]
        return codes.handle_rcodes.get(slot.data) + ' ' + this.taggedref(slot.refs[0], ['Field', 'Method', 'InterfaceMethod'])
    }

    taggedconst(ind) {
        const slot = this.cpslots[ind]
        let parts
        if (slot.tag === 'Utf8') {
            parts = [this._encode_utf(ind)]
        } else if (slot.tag === 'Int') {
            parts = [this._int(slot.data)]
        } else if (slot.tag === 'Float') {
            parts = [this._float(slot.data)]
        } else if (slot.tag === 'Long') {
            parts = [this._long(slot.data)]
        } else if (slot.tag === 'Double') {
            parts = [this._double(slot.data)]
        } else if (['Class', 'String', 'MethodType'].includes(slot.tag)) {
            parts = [this.utfref(slot.refs[0])]
        } else if (['Field', 'Method', 'InterfaceMethod'].includes(slot.tag)) {
            parts = [this.clsref(slot.refs[0]), this.natref(slot.refs[1])]
        } else if (slot.tag === 'NameAndType') {
            parts = [this.utfref(slot.refs[0]), this.utfref(slot.refs[1])]
        } else if (slot.tag === 'MethodHandle') {
            parts = [this.mhnotref(ind)]
        } else if (slot.tag === 'InvokeDynamic') {
            parts = [this.bsref(slot.refs[0]), this.natref(slot.refs[1])]
        }
        parts = [slot.tag, ...parts]
        return parts.join(' ')
    }

    taggedref(ind, allowed=null) {
        if (this.roundtrip || this.forcedraw.has(ind)) {
            return this.rawref(ind)
        }

        if (allowed === null || allowed.includes(this.cpslots[ind].tag)) {
            const temp = this.taggedconst(ind)
            if (temp.length < MAX_INLINE_SIZE) {
                return temp
            }
        }
        return this.symref(ind)
    }

    ldcrhs(ind) {
        if (this.roundtrip || this.forcedraw.has(ind)) {
            return this.rawref(ind)
        }
        const slot = this.cpslots[ind]
        const t = slot.tag

        if (t === 'Int') {
            return this._int(slot.data)
        } else if (slot.tag === 'Float') {
            return this._float(slot.data)
        } else if (slot.tag === 'Long') {
            return this._long(slot.data)
        } else if (slot.tag === 'Double') {
            return this._double(slot.data)
        } else if (t === 'String') {
            const ind2 = this.cpslots[ind].refs[0]
            const temp = this._ident(ind2, false)
            if (temp !== null) {
                return temp
            }
            return this.symref(ind)
        }
        return this.taggedref(ind, ['Class', 'MethodHandle', 'MethodType'])
    }

    bsnotref(ind, tagged=false) {
        const slot = this.bsslots[ind]
        let parts = []
        if (tagged) {
            parts.push('Bootstrap')
        }

        if (tagged && this.roundtrip) {
            parts.push(this.rawref(slot.refs[0]))
        } else {
            parts.push(this.mhnotref(slot.refs[0]))
        }

        for (let bsarg of slot.refs.slice(1)) {
            parts.push(this.taggedref(bsarg))
        }
        parts.push(':')
        return parts.join(' ')
    }

    bsref(ind) {
        if (this.roundtrip) {
            return this.rawref(ind, true)
        }
        return this.bsnotref(ind)
    }
}

class Disassembler {
    constructor(clsdata, out, roundtrip) {
        this.roundtrip = roundtrip

        this.out = out
        this.cls = clsdata
        this.pool = clsdata.pool

        this.indentlevel = 0
        this.lblfmt = null
        this.refprinter = new ReferencePrinter(clsdata, roundtrip)
    }

    _getattr(obj, name) {
        for (let attr of obj.attributes) {
            if (this.pool.getutf(attr.name) === name) {
                return attr
            }
        }
        return null
    }

    sol(text='') {
        const level = Math.min(this.indentlevel, MAX_INDENT) * 4
        text += ' '.repeat(level - text.length)
        this.out(text)
    }

    eol() {this.out('\n')}
    val(s) {this.out(s + ' ')}
    int(x) {this.val(x.toString())}
    lbl(x) {this.val(this.lblfmt(x))}
    //////////////////////////////////////////////////////////////////////////////////////////////////
    extrablankline() {this.eol()}

    ref(ind, isbs=false) {this.val(this.refprinter.ref(ind, isbs))}
    utfref(ind) {this.val(this.refprinter.utfref(ind))}
    clsref(ind) {this.val(this.refprinter.clsref(ind))}
    natref(ind) {this.val(this.refprinter.natref(ind))}
    fmimref(ind) {this.val(this.refprinter.fmimref(ind))}
    taggedbs(ind) {this.val(this.refprinter.bsnotref(ind, true))}
    taggedconst(ind) {this.val(this.refprinter.taggedconst(ind))}
    taggedref(ind) {this.val(this.refprinter.taggedref(ind))}
    ldcrhs(ind) {this.val(this.refprinter.ldcrhs(ind))}

    flags(access, names=RFLAGS) {
        for (let i of range(16)) {
            if (access & (1 << i)) {
                this.val(names.get(1 << i))
            }
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    ////// Top level stuff (class, const defs, fields, methods) ////////////////////////////////////
    disassemble() {
        const cls = this.cls
        this.val('.version'), this.int(cls.version[0]), this.int(cls.version[1]), this.eol()
        this.val('.class'), this.flags(cls.access), this.clsref(cls.this), this.eol()
        this.val('.super'), this.clsref(cls.super), this.eol()
        for (let ref of cls.interfaces) {
            this.val('.implements'), this.clsref(ref), this.eol()
        }

        for (let f of cls.fields) {
            this.field(f)
        }

        for (let m of cls.methods) {
            this.method(m)
        }

        for (let attr of cls.attributes) {
            this.attribute(attr)
        }

        this.constdefs()
        this.val('.end class'), this.eol()
    }

    field(f) {
        this.val('.field'), this.flags(f.access), this.utfref(f.name), this.utfref(f.desc)

        let attrs = f.attributes
        const cvattr = this._getattr(f, 'ConstantValue')
        if (cvattr && !this.roundtrip) {
            this.val('='), this.ldcrhs(cvattr.stream().u16())
            attrs = attrs.filter(x => x != cvattr)
        }

        if (attrs.length > 0) {
            this.val('.fieldattributes'), this.eol()
            this.indentlevel += 1
            for (let attr of attrs) {
                this.attribute(attr)
            }
            this.indentlevel -= 1
            this.val('.end fieldattributes')
        }
        this.eol()
    }

    method(m) {
        this.extrablankline()
        this.val('.method'), this.flags(m.access, RFLAGS_M), this.utfref(m.name), this.val(':'), this.utfref(m.desc), this.eol()
        this.indentlevel += 1
        for (let attr of m.attributes) {
            this.attribute(attr, true)
        }
        this.indentlevel -= 1
        this.val('.end method'), this.eol()
    }

    constdefs() {
        if (this.roundtrip) {
            for (let ind of range(this.refprinter.cpslots.length)) {
                this.constdef(ind, false)
            }
            for (let ind of range(this.refprinter.bsslots.length)) {
                this.constdef(ind, true)
            }
        } else {
            for (let ind of [...this.refprinter.forcedraw].sort((x,y) => x-y).slice(1)) {
                this.constdef(ind, false)
            }

            let done_cp = new Set()
            let done_bs = new Set()
            while (done_cp.size < this.refprinter.used_cp.size || done_bs.size < this.refprinter.used_bs.size) {
                for (let ind of [...this.refprinter.used_cp].filter(x => !done_cp.has(x)).sort((x,y) => x-y)) {
                    this.constdef(ind, false)
                    done_cp.add(ind)
                }
                for (let ind of [...this.refprinter.used_bs].filter(x => !done_bs.has(x)).sort((x,y) => x-y)) {
                    this.constdef(ind, true)
                    done_bs.add(ind)
                }
            }
        }
    }

    constdef(ind, isbs) {
        if (!isbs && this.refprinter.cpslots[ind].tag === null) {
            return
        }

        this.sol(), this.val(isbs ? '.bootstrap' : '.const'), this.ref(ind, isbs), this.val('=')
        if (isbs) {
            this.taggedbs(ind)
        } else {
            this.taggedconst(ind)
        }
        this.eol()
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    ////// Bytecode /////////////////////////////////////////////////////////////////////////////////
    code(r) {
        const [major, minor] = this.cls.version
        const isold = major < 45 || major === 45 && minor < 4

        const c = new classdata.CodeData(r, this.pool, isold)
        this.val('.code'), this.val('stack'), this.int(c.stack), this.val('locals'), this.int(c.locals), this.eol()
        this.indentlevel += 1
        console.assert(this.lblfmt === null)
        this.lblfmt = pos => `L${pos}`

        const stackreader = new StackMapReader()
        for (let attr of c.attributes) {
            if (this.pool.getutf(attr.name) === 'StackMapTable') {
                stackreader.setdata(attr.stream())
                break
            }
        }

        const rexcepts = c.exceptions.slice().reverse()
        const bcreader = new Reader(c.bytecode)
        while (bcreader.size() > 0) {
            this.insline_start(bcreader.off, rexcepts, stackreader)
            this.instruction(bcreader)
        }
        this.insline_start(bcreader.off, rexcepts, stackreader), this.eol()

        for (let attr of c.attributes) {
            this.attribute(attr)
        }
        this.lblfmt = null
        this.indentlevel -= 1
        this.sol(), this.val('.end code')
    }

    insline_start(pos, rexcepts, stackreader) {
        while (rexcepts.length && rexcepts[rexcepts.length-1].start <= pos) {
            const e = rexcepts.pop()
            this.sol(), this.val('.catch'), this.clsref(e.type), this.val('from'), this.lbl(e.start)
            this.val('to'), this.lbl(e.end), this.val('using'), this.lbl(e.handler), this.eol()
        }

        if (stackreader.count > 0 && stackreader.pos === pos) {
            const r = stackreader.stream
            const tag = stackreader.tag
            this.extrablankline()
            this.sol(), this.val('.stack')
            if (tag <= 63) {
                this.val('same')
            } else if (tag <= 127) {
                this.val('stack_1'), this.verification_type(r)
            } else if (tag === 247) {
                this.val('stack_1_extended'), this.verification_type(r)
            } else if (tag < 251) {
                this.val('chop'), this.int(251 - tag)
            } else if (tag === 251) {
                this.val('same_extended')
            } else if (tag < 255) {
                this.val('append')
                for (let _ of range(tag - 251)) {
                    this.verification_type(r)
                }
            } else {
                this.val('full')
                this.indentlevel += 1

                this.eol(), this.sol(), this.val('locals')
                for (let _ of range(r.u16())) {
                    this.verification_type(r)
                }
                this.eol(), this.sol(), this.val('stack')
                for (let _ of range(r.u16())) {
                    this.verification_type(r)
                }

                this.indentlevel -= 1
                this.eol(), this.sol(), this.val('.end stack')
            }
            this.eol()
            stackreader.parseNextPos()
        }

        this.sol(this.lblfmt(pos) + ':')
    }

    verification_type(r) {
        const tag = codes.vt_rcodes[r.u8()]
        this.val(tag)
        if (tag === 'Object') {
            this.clsref(r.u16())
        } else if (tag === 'Uninitialized') {
            this.lbl(r.u16())
        }
    }

    instruction(r) {
        const pos = r.off
        const op = OPNAMES[r.u8()]
        this.val(op)

        if (OP_LBL.has(op)) {
            this.lbl(pos + (op.endsWith('_w') ? r.s32() : r.s16()))
        } else if (OP_SHORT.has(op)) {
            this.int(r.u8())
        } else if (OP_CLS.has(op)) {
            this.clsref(r.u16())
        } else if (OP_FMIM.has(op)) {
            this.fmimref(r.u16())
        } else if (op === 'invokeinterface') {
            this.fmimref(r.u16()), this.int(r.u8()), r.u8()
        } else if (op === 'invokedynamic') {
            this.taggedref(r.u16()), r.u16()
        } else if (['ldc', 'ldc_w', 'ldc2_w'].includes(op)) {
            this.ldcrhs(op === 'ldc' ? r.u8() : r.u16())
        } else if (op === 'multianewarray') {
            this.clsref(r.u16()), this.int(r.u8())
        } else if (op === 'bipush') {
            this.int(r.s8())
        } else if (op === 'sipush') {
            this.int(r.s16())
        } else if (op === 'iinc') {
            this.int(r.u8()), this.int(r.s8())
        } else if (op === 'wide') {
            const op2 = OPNAMES[r.u8()]
            this.val(op2), this.int(r.u16())
            if (op2 === 'iinc') {
                this.int(r.s16())
            }
        } else if (op === 'newarray') {
            this.val(codes.newarr_rcodes[r.u8()])
        } else if (op === 'tableswitch') {
            r.getRaw((((3-pos) % 4) + 4) % 4)
            const default_target = pos + r.s32()
            const [low, high] = [r.s32(), r.s32()]

            this.int(low), this.eol()
            this.indentlevel += 1
            for (let _ of range(high - low + 1)) {
                this.sol(), this.lbl(pos + r.s32()), this.eol()
            }
            this.sol(), this.val('default'), this.val(':'), this.lbl(default_target), this.eol()
            this.indentlevel -= 1
        } else if (op === 'lookupswitch') {
            r.getRaw((((3-pos) % 4) + 4) % 4)
            const default_target = pos + r.s32()

            this.eol()
            this.indentlevel += 1
            for (let _ of range(r.s32())) {
                this.sol(), this.int(r.s32()), this.val(':'), this.lbl(pos + r.s32()), this.eol()
            }
            this.sol(), this.val('default'), this.val(':'), this.lbl(default_target), this.eol()
            this.indentlevel -= 1
        } else {
            console.assert(OP_NONE.has(op))
        }
        this.eol()
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    ////// Attributes /////////////////////////////////////////////////////////////////////////
    attribute(attr, in_method=false) {
        const name = this.pool.getutf(attr.name)
        if (!this.roundtrip && ['BootstrapMethods', 'StackMapTable'].includes(name)) {
            return
        }

        // this.extrablankline()
        this.sol()
        let isnamed = false
        if (this.roundtrip || name === null) {
            isnamed = true
            this.val('.attribute'), this.utfref(attr.name)
            if (attr.wronglength) {
                this.val('length'), this.int(attr.length)
            }
        }

        const r = attr.stream()
        if (name === 'AnnotationDefault') {
            this.val('.annotationdefault'), this.element_value(r)
        } else if (name === 'BootstrapMethods') {
            this.val('.bootstrapmethods')
        } else if (name === 'Code' && in_method) {
            this.code(r)
        } else if (name === 'ConstantValue') {
            this.val('.constantvalue'), this.ldcrhs(r.u16())
        } else if (name === 'Deprecated') {
            this.val('.deprecated')
        } else if (name === 'EnclosingMethod') {
            this.val('.enclosing method'), this.clsref(r.u16()), this.natref(r.u16())
        } else if (name === 'Exceptions') {
            this.val('.exceptions')
            for (let _ of range(r.u16())) {
                this.clsref(r.u16())
            }
        } else if (name === 'InnerClasses') {
            this.indented_line_list(r, this._innerclasses_item, 'innerclasses')
        } else if (name === 'LineNumberTable') {
            this.indented_line_list(r, this._linenumber_item, 'linenumbertable')
        } else if (name === 'LocalVariableTable') {
            this.indented_line_list(r, this._localvariabletable_item, 'localvariabletable')
        } else if (name === 'LocalVariableTypeTable') {
            this.indented_line_list(r, this._localvariabletable_item, 'localvariabletypetable')
        } else if (name === 'MethodParameters') {
            this.indented_line_list(r, this._methodparams_item, 'methodparameters')
        } else if (['RuntimeVisibleAnnotations', 'RuntimeVisibleParameterAnnotations', 'RuntimeVisibleTypeAnnotations', 'RuntimeInvisibleAnnotations', 'RuntimeInvisibleParameterAnnotations', 'RuntimeInvisibleTypeAnnotations'].includes(name)) {
            this.val('.runtime')
            this.val(name.includes('Inv') ? 'invisible' : 'visible')
            if (name.includes('Type')) {
                this.val('typeannotations'), this.eol()
                this.indented_line_list(r, this.type_annotation_line, 'runtime', false)
            } else if (name.includes('Parameter')) {
                this.val('paramannotations'), this.eol()
                this.indented_line_list(r, this.param_annotation_line, 'runtime', false, true)
            } else {
                this.val('annotations'), this.eol()
                this.indented_line_list(r, this.annotation_line, 'runtime', false)
            }
        } else if (name === 'StackMapTable') {
            this.val('.stackmaptable')
        } else if (name === 'Signature') {
            this.val('.signature'), this.utfref(r.u16())
        } else if (name === 'SourceDebugExtension') {
            this.val('.sourcedebugextension')
            this.val(reprbytes(attr.raw))
        } else if (name === 'SourceFile') {
            this.val('.sourcefile'), this.utfref(r.u16())
        } else if (name === 'Synthetic') {
            this.val('.synthetic')
        } else {
            // print('Nonstandard attribute', name[:70], len(attr.raw))
            if (!isnamed) {
                this.val('.attribute'), this.utfref(attr.name)
            }
            this.val(reprbytes(attr.raw))
        }
        this.eol()
    }

    indented_line_list(r, cb, dirname, dostart=true, bytelen=false) {
        cb = cb.bind(this)
        if (dostart) {
            this.val('.' + dirname), this.eol()
        }
        this.indentlevel += 1
        const count = bytelen ? r.u8() : r.u16()
        for (let _ of range(count)) {
            this.sol(), cb(r), this.eol()
        }
        this.indentlevel -= 1
        if (dirname !== null) {
            this.sol(), this.val('.end ' + dirname)
        }
    }

    _innerclasses_item(r) {this.clsref(r.u16()), this.clsref(r.u16()), this.utfref(r.u16()), this.flags(r.u16())}
    _linenumber_item(r) {this.lbl(r.u16()), this.int(r.u16())}
    _localvariabletable_item(r) {
        const [start, length, name, desc, ind] = [r.u16(), r.u16(), r.u16(), r.u16(), r.u16()]
        this.int(ind), this.val('is'), this.utfref(name), this.utfref(desc),
        this.val('from'), this.lbl(start), this.val('to'), this.lbl(start + length)
    }
    _methodparams_item(r) {this.utfref(r.u16()), this.flags(r.u16())}

    ////////////////////////////////////////////////////////////////////////////////////////////
    ////// Annotations /////////////////////////////////////////////////////////////////////////
    annotation_line(r) {
        this.val('.annotation'), this.annotation_contents(r), this.sol(), this.val('.end'), this.val('annotation')
    }

    param_annotation_line(r) {
        this.indented_line_list(r, this.annotation_line, 'paramannotation')
    }

    type_annotation_line(r) {
        this.val('.typeannotation')
        this.indentlevel += 1
        this.ta_target_info(r) // Note: begins on same line as .typeannotation
        this.ta_target_path(r)
        this.sol(), this.annotation_contents(r),
        this.indentlevel -= 1
        this.sol(), this.val('.end'), this.val('typeannotation')
    }

    ta_target_info(r) {
        const tag = r.u8()
        this.int(tag)
        if (tag <= 0x01) {
            this.val('typeparam'), this.int(r.u8())
        } else if (tag <= 0x10) {
            this.val('super'), this.int(r.u16())
        } else if (tag <= 0x12) {
            this.val('typeparambound'), this.int(r.u8()), this.int(r.u8())
        } else if (tag <= 0x15) {
            this.val('empty')
        } else if (tag <= 0x16) {
            this.val('methodparam'), this.int(r.u8())
        } else if (tag <= 0x17) {
            this.val('throws'), this.int(r.u16())
        } else if (tag <= 0x41) {
            this.val('localvar'), this.eol()
            this.indented_line_list(r, this._localvarrange, 'localvar', false)
        } else if (tag <= 0x42) {
            this.val('catch'), this.int(r.u16())
        } else if (tag <= 0x46) {
            this.val('offset'), this.lbl(r.u16())
        } else {
            this.val('typearg'), this.lbl(r.u16()), this.int(r.u8())
        }
        this.eol()
    }

    _localvarrange(r) {
        const [start, length, index] = [r.u16(), r.u16(), r.u16()]
        if (start === 0xFFFF && length === 0xFFFF) { // WTF, Java?
            this.val('nowhere')
        } else {
            this.val('from'), this.lbl(start), this.val('to'), this.lbl(start + length)
        }
        this.int(index)
    }

    ta_target_path(r) {
        this.sol(), this.indented_line_list(r, this._type_path_segment, 'typepath', true, true), this.eol()
    }

    _type_path_segment(r) {
        this.int(r.u8()), this.int(r.u8())
    }

    // The following are recursive and can be nested arbitrarily deep,
    // so we use generators and a thunk to avoid the Python stack limit.
    element_value(r) {thunk(this._element_value(r))}
    annotation_contents(r) {thunk(this._annotation_contents(r))}

    *_element_value(r) {
        const tag = codes.et_rtags.get(r.u8())
        this.val(tag)
        if (tag === 'annotation') {
            (yield this._annotation_contents(r)), this.sol(), this.val('.end'), this.val('annotation')
        } else if (tag === 'array') {
            this.eol()
            this.indentlevel += 1
            for (let _ of range(r.u16())) {
                this.sol(), (yield this._element_value(r)), this.eol()
            }
            this.indentlevel -= 1
            this.sol(), this.val('.end'), this.val('array')
        } else if (tag === 'enum') {
            this.utfref(r.u16()), this.utfref(r.u16())
        } else if (tag === 'class' || tag === 'string') {
            this.utfref(r.u16())
        } else {
            this.ldcrhs(r.u16())
        }
    }

    *_annotation_contents(r) {
        this.utfref(r.u16()), this.eol()
        this.indentlevel += 1
        for (let _ of range(r.u16())) {
            this.sol(), this.utfref(r.u16()), this.val('='), (yield this._element_value(r)), this.eol()
        }
        this.indentlevel -= 1
    }
}

module.exports = {Disassembler}

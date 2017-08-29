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
const floatToWord = require('../deps/math-float32-to-word/lib/index.js');
const doubleToWords = require('../deps/math-float64-to-words/lib/index.js');

const {int, INTS, M32, wordsToU64, mod, range} = require('../std')

const mutf8 = require('../classfileformat/mutf8')
const {thunk} = require('../util/thunk')

const assembly = require('./assembly')
const codes = require('./codes')
const pool = require('./pool')
const {FLAGS} = require('./flags')
const {OPNAME_TO_BYTE, OP_CLS, OP_FMIM_TO_GUESS, OP_LBL, OP_NONE, OP_SHORT} = require('./instructions')
const {Tokenizer, AssemblerError} = require('./tokenize')
const {Writer} = require('../classfileformat/writer')

function partitionBuf(buf, c) {
    const ind = buf.indexOf(c)
    if (ind < 0) {
        return [buf, new Buffer(0)]
    }
    return [buf.slice(0, ind), buf.slice(ind+1)]
}

function rpartitionBuf(buf, c) {
    const ind = buf.lastIndexOf(c)
    if (ind < 0) {
        return [new Buffer(0), buf]
    }
    return [buf.slice(0, ind), buf.slice(ind+1)]
}

function parseString(lit) {
    const orig = lit
    const quote = lit[0]
    lit = lit.slice(1, -1)

    let s = ''
    while (lit.length > 0) {
        let ind = lit.indexOf('\\')
        if (ind === -1) {
            s += lit
            break
        } else {
            s += lit.slice(0, ind)
            lit = lit.slice(ind)
        }

        const next = lit[1]
        if (next === 'u') {
            s += String.fromCharCode(parseInt(lit.slice(2, 6), 16))
            lit = lit.slice(6)
        } else if (next === 'x') {
            s += String.fromCharCode(parseInt(lit.slice(2, 4), 16))
            lit = lit.slice(4)
        } else if ('01234567'.includes(next)) {
            const match = lit.match(/^\\[0-7][0-7]?[0-7]?/)[0].slice(1)
            s += String.fromCharCode(parseInt(match, 8))
            lit = lit.slice(1 + match.length)
        } else if ('btnfr'.includes(next)) {
            s += JSON.parse(`"\\${next}"`)
            lit = lit.slice(2)
        } else {
            s += lit[1]
            lit = lit.slice(2)
        }
    }
    return s
}



function formatList(vals) {
    if (vals.length > 1) {
        vals.push('or ' + vals.pop())
    }
    const sep = vals.length > 2 ? ', ' : ' '
    return vals.join(sep)
}

function parseFloatStr(s, isfloat) {
    s = s.toLowerCase()

    // ugly hack to replicate behavior of Python Krakatau
    if (s === '-nan') {
        return isfloat ? int('ffc00000', 16) : int('fff8000000000000', 16)
    }

    if (s.endsWith('>')) {
        return int(s.match(/<0x(\w+)>/)[1], 16)
    }

    let f
    if (s.includes('0x')) {
        let [, mstr, estr] = s.match(/0[xX]([0-9a-fA-F.]+)[pP]([+-]?\d+)/)
        let mantissa = int(mstr.replace('.', ''), 16)
        let exponent = parseInt(estr, 10)
        if (mstr.includes('.')) {
            const shift = mstr.length - mstr.indexOf('.') - 1
            exponent -= shift * 4
        }

        // Careful! Make sure exponent multiplier doesn't underflow
        if (exponent < -1074) {
            mantissa = mantissa.shiftRight(-1074 - exponent)
            exponent = -1074
        }

        f = mantissa.valueOf() * Math.pow(2, exponent)
        if (s.startsWith('-')) {
            f = -f
        }
    } else {
        // parseFloat only handles exact capitalization of Infinity
        f = parseFloat(s.replace('inf', 'Inf'))
    }

    if (isfloat) {
        return int(floatToWord(f))
    } else {
        return wordsToU64(...doubleToWords(f))
    }
}

function parseIntStr(s) {
    s = s.toLowerCase().replace('+', '').replace('l', '')
    if (s.includes('0x')) {
        return int(s.replace('0x', ''), 16)
    }
    return int(s)
}

class Parser {
    constructor(tokenizer) {
        this.tokenizer = tokenizer
        this.tok = null
        this.consume()

        this.cls = new assembly.Class
        this.field = this.method = this.code = null
    }

    _next_token() {return this.tokenizer.next()}

    _format_error_args(message, tok) {
        if (tok.type === 'NEWLINES' || tok.type === 'EOF') {
            return [message, tok.pos, tok.pos+1]
        } else {
            return [message, tok.pos, tok.pos + tok.val.length]
        }
    }

    error(...args) {
        const pairs = []
        for (let i = 0; i < args.length; i += 2) {
            pairs.push(this._format_error_args(args[i], args[i+1]))
        }
        this.tokenizer.error(...pairs)
    }

    fail() {
        const expected = [...this.triedtypes.sort(), ...this.triedvals.sort()]
        this.error(`Expected ${formatList(expected)}.`, this.tok)
    }

    consume() {
        const tok = this.tok
        this.triedvals = []
        this.triedtypes = []
        this.tok = this._next_token()
        return tok
    }


    hasv(val) {
        this.triedvals.push(val)
        return this.tok.val === val
    }

    hasany(vals) {
        if (!(vals instanceof Array)) {
            vals = [...vals.keys()]
        }

        this.triedvals = this.triedvals.concat(vals)
        return vals.includes(this.tok.val)
    }

    hastype(t) {
        this.triedtypes.push(t)
        return this.tok.type === t
    }

    asserttype(t) {
        this.triedtypes.push(t)
        if (this.tok.type !== t) {
            this.fail()
        }
    }

    tryv(val) {
        if (this.hasv(val)) {
            this.consume()
            return true
        }
        return false
    }

    val(val) {
        if (!this.tryv(val)) {
            this.fail()
        }
    }

    ateol() {return this.hastype('NEWLINES')}
    atendtok() {return this.hasv('.end')}

    listu8(w, endcb, callback) {
        const a = this
        endcb = endcb.bind(this)
        callback = callback.bind(this)

        let [count, pos] = [0, w.ph8()]
        while (!endcb()) {
            if (count >= 255) {
                a.error(`Maximum 255 items.`, a.tok)
            }
            count += 1
            callback(w)
        }
        w.setph8(pos, count)
    }

    list(w, endcb, callback) {
        const a = this
        endcb = endcb.bind(this)
        callback = callback.bind(this)

        let [count, pos] = [0, w.ph16()]
        while (!endcb()) {
            if (count >= 65535) {
                a.error(`Maximum 65535 items.`, a.tok)
            }
            count += 1
            callback(w)
        }
        w.setph16(pos, count)
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    eol() {
        const a = this
        a.asserttype('NEWLINES'), a.consume()
    }

    boundedint(lower, upper) {
        const a = this
        a.asserttype('INT_LITERAL')
        const tok = a.tok
        const s = a.consume().val
        const x = parseInt(s, s.toLowerCase().includes('x') ? 16 : 10)

        if (!(lower <= x && x < upper)) {
            a.error(`Value must be in range ${lower} <= x < ${upper}.`, tok)
        }
        return x
    }

    u8() {return this.boundedint(0, 1<<8)}
    u16() {return this.boundedint(0, 1<<16)}
    u32() {return this.boundedint(0, 0x100000000)}
    s8() {return this.boundedint(-1<<7, 1<<7)}
    s16() {return this.boundedint(-1<<15, 1<<15)}
    s32() {return this.boundedint(-0x80000000, 0x80000000)}

    string(maxlen=65535) {
        const a = this
        a.asserttype('STRING_LITERAL')
        const tok = a.consume()
        let tokval = tok.val

        let buf
        if ('bB'.includes(tokval[0])) {
            buf = Buffer.from(parseString(tokval.slice(1)), 'latin1')
        } else {
            buf = mutf8.encode(parseString(tokval))
        }

        if (buf.length > maxlen) {
            a.error(`Maximum string length here is ${maxlen} bytes (${buf.length} found).`, tok)
        }
        return buf
    }

    word(maxlen=65535) {
        const a = this
        a.asserttype('WORD')
        const tok = a.consume()
        const val = tok.val
        if (val.length > maxlen) {
            a.error(`Maximum identifier length is ${maxlen} bytes (${val.length} found).`, tok)
        }
        return Buffer.from(val)
    }

    identifier() {
        const a = this
        if (a.hastype('WORD')) {
            return a.word()
        } else if (a.hastype('STRING_LITERAL')) {
            return a.string()
        }
        a.fail()
    }

    intl() {
        const a = this
        a.asserttype('INT_LITERAL')
        const tok = a.consume()
        const x = parseIntStr(tok.val)
        if (x < INTS.INT_MIN || x > INTS.INT_MAX) {
            a.error(`Value does not fit into int type.`, tok)
        }
        return x.add(INTS.M32).mod(INTS.M32)
    }

    longl() {
        const a = this
        a.asserttype('LONG_LITERAL')
        const tok = a.consume()
        const x = parseIntStr(tok.val)
        if (x < INTS.LONG_MIN || x > INTS.LONG_MAX) {
            a.error(`Value does not fit into long type.`, tok)
        }
        return x.add(INTS.M64).mod(INTS.M64)
    }

    floatl() {
        const a = this
        a.asserttype('FLOAT_LITERAL')
        return parseFloatStr(a.consume().val.slice(0, -1), true)
    }

    doublel() {
        const a = this
        a.asserttype('DOUBLE_LITERAL')
        return parseFloatStr(a.consume().val, false)
    }

    ref(isbs=false) {
        const a = this
        a.asserttype('REF')
        const tok = a.consume()

        const content = tok.val.slice(1, -1)
        const bootstrap = content.startsWith('bs:')
        if (isbs && !bootstrap) {
            a.error(`Expected bootstrap reference, found constant pool reference.`, tok)
        } else if (!isbs && bootstrap) {
            a.error(`Expected constant pool reference, found bootstrap reference.`, tok)
        }

        const val = content.replace('bs:', '')
        if (/^\d+$/.test(val)) {
            const index = parseInt(val, 10)
            if (index >= 0xFFFF) { // note: strict upper bound
                a.error(`Reference must be in range 0 <= x < 65535.`, tok)
            }
            return new pool.Ref(tok, {index, isbs: bootstrap})
        } else {
            return new pool.Ref(tok, {symbol: val, isbs: bootstrap})
        }
    }

    utfref() {
        const a = this
        if (a.hastype('REF')) {
            return a.ref()
        }
        return pool.utf(a.tok, a.identifier())
    }

    clsref() {
        const a = this
        if (a.hastype('REF')) {
            return a.ref()
        }
        return pool.single('Class', a.tok, a.identifier())
    }

    natref() {
        const a = this
        if (a.hastype('REF')) {
            return a.ref()
        }
        const name = pool.utf(a.tok, a.identifier())
        const desc = a.utfref()
        return new pool.Ref(name.tok, {type: 'NameAndType', refs: [name, desc]})
    }

    fmimref(typeguess) {
        const a = this
        // This rule requires extra lookahead
        if (a.hastype('REF')) {
            const first = a.ref()
            // Legacy method syntax
            if (a.hastype('WORD')) {
                return new pool.Ref(first.tok, {type: typeguess, refs: [first, a.natref()]}) // Krakatau v0
            }
            return first
        } else if (a.hasany(['Field', 'Method', 'InterfaceMethod'])) {
            return a.tagged_const()
        }

        // Legacy method syntax - attempt to support Jasmin's awful syntax too
        const words = []
        while (words.length < 3 && a.hastype('WORD')) {
            words.push([a.tok, a.word()])
        }

        if (1 <= words.length && words.length <= 2 && a.hastype('REF')) { // Krakatau v0
            const cls = pool.single('Class', ...words[0])
            if (words.length === 2) {
                const name = pool.utf(...words[1])
                return new pool.Ref(cls.tok, {type: typeguess, refs: [cls, pool.nat(name, a.utfref())]})
            }
            return new pool.Ref(cls.tok, {type: typeguess, refs: [cls, a.natref()]})
        }

        let cls, name, desc
        if (words.length === 3) { // Krakatau v0
            cls = pool.single('Class', ...words[0])
            name = pool.utf(...words[1])
            desc = pool.utf(...words[2])
        } else if (words.length === 2) { // Jasmin field syntax
            const [tok, cnn] = words[0]
            const [left, right] = rpartitionBuf(cnn, '/')

            cls = pool.single('Class', tok, left)
            name = pool.utf(tok, right)
            desc = pool.utf(...words[1])
        } else if (words.length === 1) { // Jasmin method syntax
            const [tok, cnnd] = words[0]
            const [cnn, d] = partitionBuf(cnnd, '(')
            const d_withparen = cnnd.slice(cnn.length)
            const [left, right] = rpartitionBuf(cnn, '/')

            cls = pool.single('Class', tok, left)
            name = pool.utf(tok, right)
            desc = pool.utf(tok, d_withparen)
        } else {
            a.fail()
        }
        return new pool.Ref(cls.tok, {type: typeguess, refs: [cls, pool.nat(name, desc)]})
    }

    *bootstrapargs() {
        const a = this
        while (!a.hasv(':')) {
            yield a.ref_or_tagged_const({methodhandle: true})
        }
        a.val(':')
    }

    bsref() {
        const a = this
        const tok = a.tok
        if (a.hastype('REF')) {
            return a.ref(true)
        }
        const refs = [a.mhnotref(a.tok), ...a.bootstrapargs()]
        return new pool.Ref(tok, {type: 'Bootstrap', refs, isbs: true})
    }

    mhnotref(tok) {
        const a = this
        if (a.hasany(codes.handle_codes)) {
            const code = codes.handle_codes.get(a.consume().val)
            return new pool.Ref(tok, {type: 'MethodHandle', data: code, refs: [a.ref_or_tagged_const()]})
        }
        a.fail()
    }

    tagged_const({methodhandle=false, invokedynamic=false} = {}) {
        const a = this
        const tok = a.tok
        if (a.tryv('Utf8')) {
            return pool.utf(tok, a.identifier())
        } else if (a.tryv('Int')) {
            return pool.primitive(tok.val, tok, a.intl())
        } else if (a.tryv('Float')) {
            return pool.primitive(tok.val, tok, a.floatl())
        } else if (a.tryv('Long')) {
            return pool.primitive(tok.val, tok, a.longl())
        } else if (a.tryv('Double')) {
            return pool.primitive(tok.val, tok, a.doublel())
        } else if (a.hasany(['Class', 'String', 'MethodType'])) {
            a.consume()
            return new pool.Ref(tok, {type: tok.val, refs: [a.utfref()]})
        } else if (a.hasany(['Field', 'Method', 'InterfaceMethod'])) {
            a.consume()
            return new pool.Ref(tok, {type: tok.val, refs: [a.clsref(), a.natref()]})
        } else if (a.tryv('NameAndType')) {
            return new pool.Ref(tok, {type: tok.val, refs: [a.utfref(), a.utfref()]})
        } else if (methodhandle && a.tryv('MethodHandle')) {
            return a.mhnotref(tok)
        } else if (invokedynamic && a.tryv('InvokeDynamic')) {
            return new pool.Ref(tok, {type: tok.val, refs: [a.bsref(), a.natref()]})
        } else if (a.tryv('Bootstrap')) {
            const first = a.hastype('REF') ? a.ref() : a.mhnotref(a.tok)
            const refs = [first, ...a.bootstrapargs()]
            return new pool.Ref(tok, {type: tok.val, refs, isbs: true})
        }
        a.fail()
    }

    ref_or_tagged_const({isbs=false, methodhandle=false, invokedynamic=false} = {}) {
        const a = this
        let ref
        if (a.hastype('REF')) {
            ref = a.ref(isbs)
        } else {
            ref = a.tagged_const({methodhandle, invokedynamic})
        }

        if (isbs && !ref.isbs) {
            a.error(`Expected bootstrap reference, found constant pool reference.`, ref.tok)
        } else if (!isbs && ref.isbs) {
            a.error(`Expected constant pool reference, found bootstrap reference.`, ref.tok)
        }
        return ref
    }

    ldc_rhs() {
        const a = this
        const tok = a.tok
        if (a.hastype('INT_LITERAL')) {
            return pool.primitive('Int', tok, a.intl())
        } else if (a.hastype('FLOAT_LITERAL')) {
            return pool.primitive('Float', tok, a.floatl())
        } else if (a.hastype('LONG_LITERAL')) {
            return pool.primitive('Long', tok, a.longl())
        } else if (a.hastype('DOUBLE_LITERAL')) {
            return pool.primitive('Double', tok, a.doublel())
        } else if (a.hastype('STRING_LITERAL')) {
            return pool.single('String', a.tok, a.string())
        }
        return a.ref_or_tagged_const({methodhandle: true})
    }

    flags() {
        const a = this
        let flags = 0
        while (a.hasany(FLAGS)) {
            flags |= FLAGS.get(a.consume().val)
        }
        return flags
    }

    lbl() {
        const a = this
        a.asserttype('WORD')
        if (!a.tok.val.startsWith('L')) {
            a.error(`Labels must start with L.`, a.tok)
        }
        if (a.code === null) {
            a.error(`Labels may only be used inside of a Code attribute.`, a.tok)
        }
        return assembly.Label(a.tok, a.consume().val)
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    ////// Top level stuff (class, const defs, fields, methods) ////////////////////////////////////
    parseClass() {
        const a = this
        a.version_opt()
        a.class_start()

        // Workaround for legacy code without .end class
        while (!(a.atendtok() || a.hastype('EOF'))) {
            a.class_item()
        }

        if (a.tryv('.end')) {
            a.val('class')
            a.asserttype('NEWLINES')
        }
        return a.cls.assemble(a.error.bind(a))
    }

    version_opt() {
        const a = this
        if (a.tryv('.version')) {
            const [major, minor] = a.cls.version = [a.u16(), a.u16()]
            a.cls.useshortcodeattrs = major < 45 || major === 45 && minor < 3
            a.eol()
        }
    }

    class_start() {
        const a = this
        a.val('.class')
        a.cls.access = a.flags()
        a.cls.this = a.clsref()
        a.eol()

        a.val('.super')
        a.cls.super = a.clsref()
        a.eol()

        while (a.tryv('.implements')) {
            a.cls.interfaces.push(a.clsref())
            a.eol()
        }
    }

    class_item() {
        const a = this
        a.try_const_def() || a.try_field() || a.try_method() || a.try_attribute(a.cls) || a.fail()
    }

    try_const_def() {
        const a = this
        if (a.hasany(['.const', '.bootstrap'])) {
            const isbs = a.consume().val === '.bootstrap'
            const lhs = a.ref(isbs)
            if (lhs.isbs !== isbs) {
                a.error(`Const/Bootstrap reference mismatch.`, lhs.tok)
            }
            a.val('=')

            const rhs = a.ref_or_tagged_const({isbs, methodhandle: true, invokedynamic: true})
            console.assert(rhs.isbs === isbs)
            if (lhs.israw() && (rhs.israw() || rhs.issym())) {
                a.error(`Raw references can!be aliased to another reference.`, rhs.tok)
            }
            a.eol()

            a.cls.pool.sub(lhs).adddef(lhs, rhs, a.error.bind(a))
            return true
        }
        return false
    }

    try_field() {
        const a = this
        if (a.hasv('.field')) {
            const f = a.field_start()
            a.initial_value_opt()

            if (a.tryv('.fieldattributes')) {
                a.eol()
                while (!a.atendtok()) {
                    a.try_attribute(f) || a.fail()
                }
                a.val('.end'), a.val('fieldattributes')
            }

            a.eol()
            a.cls.fields.push(f)
            a.field = null
            return true
        }
        return false
    }

    field_start() {
        const a = this
        const [tok, flags, name, desc] = [a.consume(), a.flags(), a.utfref(), a.utfref()]
        a.field = new assembly.Field(tok, flags, name, desc)
        return a.field
    }

    initial_value_opt() {
        const a = this
        const tok = a.tok
        if (a.tryv('=')) {
            const attr = new assembly.Attribute(tok, 'ConstantValue')
            attr.data.ref(a.ldc_rhs())
            a.field.attributes.push(attr)
        }
    }

    try_method() {
        const a = this
        if (a.hasv('.method')) {
            const m = a.method_start()

            // Legacy syntax
            if (a.hasv('.throws')) {
                const throws = new assembly.Attribute(a.consume(), 'Exceptions')
                m.attributes.push(throws)
                throws.data.u16(1)
                throws.data.ref(a.clsref())
                a.eol()
            }

            if (a.hasv('.limit')) {
                a.legacy_method_body()
            } else {
                while (!a.atendtok()) {
                    a.try_attribute(m) || a.fail()
                }
            }

            a.val('.end'), a.val('method'), a.eol()
            a.cls.methods.push(m)
            a.method = null
            return true
        }
        return false
    }

    method_start() {
        const a = this
        const [tok, flags, name, , desc, ] = [a.consume(), a.flags(), a.utfref(), a.val(':'), a.utfref(), a.eol()]
        a.method = new assembly.Method(tok, flags, name, desc)
        return a.method
    }

    legacy_method_body() {
        const a = this
        const c = a.code = new assembly.Code(a.tok, a.cls.useshortcodeattrs)
        const limitfunc = (c.short ? a.u8 : a.u16).bind(a)
        while (a.tryv('.limit')) {
            if (a.tryv('stack')) {
                c.stack = limitfunc()
            } else if (a.tryv('locals')) {
                c.locals = limitfunc()
            } else {
                a.fail()
            }
            a.eol()
        }
        a.code_body()
        a.code = null

        const attr = new assembly.Attribute(c.tok, 'Code')
        c.assembleNoCP(attr.data, a.error.bind(a))
        a.method.attributes.push(attr)
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    ////// Bytecode /////////////////////////////////////////////////////////////////////////////
    code_body() {
        const a = this
        while (a.try_instruction_line() || a.try_code_directive()) {}
        while (!a.atendtok()) {
            a.try_attribute(a.code) || a.fail()
        }
    }

    try_instruction_line() {
        const a = this
        const haslbl = a.hastype('LABEL_DEF')
        if (haslbl) {
            const lbl = assembly.Label(a.tok, a.consume().val.slice(0, -1))
            a.code.labeldef(lbl, a.error.bind(a))
        }

        const hasinstr = a.try_instruction()
        if (haslbl || hasinstr) {
            a.eol()
            return true
        }
        return false
    }

    try_instruction() {
        const a = this
        const w = a.code.bytecode
        const starttok = a.tok
        const op = a.tok.val

        if (a.hasany(OP_NONE)) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val))
        } else if (a.hasany(OP_LBL)) {
            const pos = w.pos
            w.u8(OPNAME_TO_BYTE.get(a.consume().val))

            const dtype = op.endsWith('_w') ? 's32' : 's16'
            w.lbl(a.lbl(), pos, dtype)
        } else if (a.hasany(OP_SHORT)) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.u8(a.u8())
        } else if (a.hasany(OP_CLS)) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.ref(a.clsref())
        } else if (a.hasany(OP_FMIM_TO_GUESS)) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.ref(a.fmimref(OP_FMIM_TO_GUESS.get(op)))
        } else if (a.hasv('invokeinterface')) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val))
            let ref = a.fmimref('InterfaceMethod')
            w.ref(ref)

            if (a.hastype('INT_LITERAL')) {
                w.u8(a.u8())
            } else {
                a.asserttype('NEWLINES') // print more helpful error for malformed refs
                if (ref.israw() || ref.issym()) {
                    a.error(`Method descriptor must be specified inline when argument count is omitted.`, ref.tok)
                }
                ref = ref.refs[1] // NAT
                if (ref.israw() || ref.issym()) {
                    a.error(`Method descriptor must be specified inline when argument count is omitted.`, ref.tok)
                }
                ref = ref.refs[1] // utf
                if (ref.israw() || ref.issym()) {
                    a.error(`Method descriptor must be specified inline when argument count is omitted.`, ref.tok)
                }
                let desc = mutf8.decode(ref.data)
                desc = desc.slice(1) // strip '('
                let count = 1
                while (desc) {
                    if (desc.startsWith('J') || desc.startsWith('D')) {
                        count += 1
                    } else {
                        while (desc.startsWith('[')) {
                            desc = desc.slice(1)
                        }
                    }

                    if (desc.startsWith('L')) {
                        const ind = desc.indexOf(';')
                        desc = desc.slice(ind+1)
                    } else if (desc.startsWith(')')) {
                        break
                    } else {
                        desc = desc.slice(1)
                    }
                    count += 1
                }
                w.u8(count & 255)
            }
            w.u8(0)

        } else if (a.hasv('invokedynamic')) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.ref(a.ref_or_tagged_const({invokedynamic: true})), w.u16(0)
        } else if (a.hasany(['ldc', 'ldc_w', 'ldc2_w'])) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val))
            const rhs = a.ldc_rhs()
            if (op === 'ldc') {
                if (rhs.israw() && rhs.index >= 256) {
                    a.error(`Ldc index must be <= 255.`, rhs.tok)
                }
                w.refu8(rhs)
            } else {
                w.ref(rhs)
            }
        } else if (a.hasv('multianewarray')) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.ref(a.clsref()), w.u8(a.u8())
        } else if (a.hasv('bipush')) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.s8(a.s8())
        } else if (a.hasv('sipush')) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.s16(a.s16())
        } else if (a.hasv('iinc')) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.u8(a.u8()), w.s8(a.s8())
        } else if (a.hasv('wide')) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val))
            if (a.hasv('iinc')) {
                w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.u16(a.u16()), w.s16(a.s16())
            } else if (a.hasany(OP_SHORT)) {
                w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.u16(a.u16())
            } else {
                a.fail()
            }
        } else if (a.hasv('newarray')) {
            w.u8(OPNAME_TO_BYTE.get(a.consume().val))
            if (a.hasany(codes.newarr_codes)) {
                w.u8(codes.newarr_codes.get(a.consume().val))
            } else {
                a.fail()
            }
        } else if (a.hasv('tableswitch')) {
            const pos = w.pos
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.writeBytes(Buffer.alloc(mod(3-pos, 4)))
            const low = a.s32()
            a.eol()

            const jumps = []
            while (!a.hasv('default')) {
                jumps.push(a.lbl()), a.eol()
                if (low + jumps.length - 1 > 0x7FFFFFFF) {
                    a.error(`Table switch index must be at most 2147483647.`, jumps[jumps.length-1].tok)
                }
            }
            if (!jumps.length) {
                a.error(`Table switch must have at least one non-default jump.`, a.tok)
            }

            const [, , default_] = [a.val('default'), a.val(':'), a.lbl()]
            w.lbl(default_, pos, 's32')
            w.s32(low)
            w.s32(low + jumps.length - 1)
            jumps.forEach(lbl => w.lbl(lbl, pos, 's32'))
        } else if (a.hasv('lookupswitch')) {
            const pos = w.pos
            w.u8(OPNAME_TO_BYTE.get(a.consume().val)), w.writeBytes(Buffer.alloc(mod(3-pos, 4)))
            a.eol()

            const jumps = new Map()
            const prevtoks = new Map()
            while (!a.hasv('default')) {
                const [keytok, key, , jump, ] = [a.tok, a.s32(), a.val(':'), a.lbl(), a.eol()]
                if (jumps.has(key)) {
                    a.error(`Duplicate lookupswitch key.`, keytok,
                            'Key previously defined here:', prevtoks.get(key))
                } else if (jumps.size > 0x80000000 - 1) {
                    a.error(`Lookup switch can have at most 2147483647 jumps.`, keytok)
                }
                jumps.set(key, jump)
                prevtoks.set(key, keytok)
            }

            const [, , default_] = [a.val('default'), a.val(':'), a.lbl()]
            w.lbl(default_, pos, 's32')
            w.s32(jumps.size)
            for (const key of [...jumps.keys()].sort((x,y) => x-y)) {
                w.s32(key)
                w.lbl(jumps.get(key), pos, 's32')
            }
        } else {
            return false
        }

        if (w.length > a.code.maxcodelen) {
            this.error(`Maximum bytecode length is {} (current {}).`.format(a.code.maxcodelen, w.length), starttok)
        }
        return true
    }

    try_code_directive() {
        const a = this
        const tok = a.tok
        if (a.tryv('.catch')) {
            if (a.code.exceptcount + 1 > 0xFFFF) {
                a.error(`Maximum 65535 exception handlers per method.`, tok)
            }
            const [ref, [froml, tol], , usingl, ] = [a.clsref(), a.code_range(), a.val('using'), a.lbl(), a.eol()]
            a.code.catch(ref, froml, tol, usingl)
            return true
        } else if (a.tryv('.stack')) {
            const w = a.code.stackdata
            const pos = a.code.bytecode.pos
            const delta_offset = pos - a.code.laststackoff - 1
            const frame_type = a.tok.val
            if (delta_offset < 0) {
                a.error(`Stack frame has same offset as previous frame.`, tok)
            }

            if (a.tryv('same')) {
                a._check_delta(tok, frame_type, delta_offset, 63)
                w.u8(delta_offset)
            } else if (a.tryv('stack_1')) {
                a._check_delta(tok, frame_type, delta_offset, 63)
                w.u8(delta_offset + 64)
                a.verification_type(w)
            } else if (a.tryv('stack_1_extended')) {
                a._check_delta(tok, frame_type, delta_offset, 0xFFFF)
                w.u8(247)
                w.u16(delta_offset)
                a.verification_type(w)
            } else if (a.tryv('chop')) {
                a._check_delta(tok, frame_type, delta_offset, 0xFFFF)
                w.u8(251 - a.boundedint(1, 4))
                w.u16(delta_offset)
            } else if (a.tryv('same_extended')) {
                a._check_delta(tok, frame_type, delta_offset, 0xFFFF)
                w.u8(251)
                w.u16(delta_offset)
            } else if (a.tryv('append')) {
                a._check_delta(tok, frame_type, delta_offset, 0xFFFF)

                let tag = 252
                const temp = new Writer()
                a.verification_type(temp)
                if (!a.ateol()) {
                    tag += 1
                    a.verification_type(temp)
                    if (!a.ateol()) {
                        tag += 1
                        a.verification_type(temp)
                    }
                }

                w.u8(tag)
                w.u16(delta_offset)
                w.addeq(temp)
            } else if (a.tryv('full')) {
                a._check_delta(tok, frame_type, delta_offset, 0xFFFF)
                w.u8(255)
                w.u16(delta_offset)
                a.eol(), a.val('locals'), a.list(w, a.ateol, a.verification_type)
                a.eol(), a.val('stack'), a.list(w, a.ateol, a.verification_type)
                a.eol(), a.val('.end'), a.val('stack')
            } else {
                a.fail()
            }

            a.eol()
            a.code.laststackoff = pos
            a.code.stackcount += 1
            return true
        }
        return false
    }

    code_range() {
        const a = this
        const [, start, , end] = [a.val('from'), a.lbl(), a.val('to'), a.lbl()]
        return [start, end]
    }

    _check_delta(tok, frame_type, delta_offset, maxv) {
        const a = this
        if (delta_offset > maxv) {
            a.error(`Stack frame type "${frame_type}" must appear at most ${maxv+1} bytes after the previous frame (actual offset is ${delta_offset+1}).`, tok)
        }
    }

    verification_type(w) {
        const a = this
        const val = a.tok.val
        if (!a.hasany(codes.vt_codes)) {
            a.fail()
        }

        w.u8(codes.vt_codes.get(a.consume().val))
        if (val === 'Object') {
            w.ref(a.clsref())
        } else if (val === 'Uninitialized') {
            w.lbl(a.lbl(), 0, 'u16')
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    ////// Attributes ///////////////////////////////////////////////////////////////////////////
    try_attribute(parent) {
        const a = this
        if (a.hasv('.attribute')) {
            const [startok, name] = [a.consume(), a.utfref()]
            let attr
            if (a.tryv('length')) {
                attr = new assembly.Attribute(startok, name, a.u32())
            } else {
                attr = new assembly.Attribute(startok, name)
            }

            // Now get data
            if (a.hastype('STRING_LITERAL')) {
                attr.data.writeBytes(a.string(0xFFFFFFFF))
            } else {
                const namedattr = a.maybe_named_attribute(attr)
                if (namedattr !== null) {
                    attr.data = namedattr.data
                } else {
                    a.fail()
                }
            }
            a.eol()
            parent.attributes.push(attr)
            return true
        } else {
            const namedattr = a.maybe_named_attribute(null)
            if (namedattr !== null) {
                a.eol()
                parent.attributes.push(namedattr)
                return true
            }
        }
        return false
    }

    maybe_named_attribute(wrapper_attr) {
        const a = this
        const starttok = a.tok

        function create(name) {
            const attr = new assembly.Attribute(starttok, name)
            return [attr, attr.data]
        }

        let attr, w
        if (a.tryv('.annotationdefault')) {
            ;[attr, w] = create('AnnotationDefault')
            a.element_value(w)
        } else if (a.tryv('.bootstrapmethods')) {
            ;[attr, w] = create('BootstrapMethods')
            a.cls.bootstrapmethods = wrapper_attr || attr
        } else if (a.code === null && a.tryv('.code')) {
            const c = a.code = new assembly.Code(starttok, a.cls.useshortcodeattrs)
            const limitfunc = (c.short ? a.u8 : a.u16).bind(a)
            ;[, c.stack, , c.locals, ] = [a.val('stack'), limitfunc(), a.val('locals'), limitfunc(), a.eol()]
            a.code_body()
            a.val('.end'), a.val('code')
            a.code = null
            ;[attr, w] = create('Code')
            c.assembleNoCP(w, a.error.bind(a))
        } else if (a.tryv('.constantvalue')) {
            ;[attr, w] = create('ConstantValue')
            w.ref(a.ldc_rhs())
        } else if (a.tryv('.deprecated')) {
            ;[attr, w] = create('Deprecated')
        } else if (a.tryv('.enclosing')) {
            ;[attr, w] = create('EnclosingMethod')
            a.val('method'), w.ref(a.clsref()), w.ref(a.natref())
        } else if (a.tryv('.exceptions')) {
            ;[attr, w] = create('Exceptions')
            a.list(w, a.ateol, a._exceptions_item)
        } else if (a.tryv('.innerclasses')) {
            ;[attr, w] = create('InnerClasses')
            a.eol(), a.list(w, a.atendtok, a._innerclasses_item), a.val('.end'), a.val('innerclasses')
        } else if (a.tryv('.linenumbertable')) {
            ;[attr, w] = create('LineNumberTable')
            a.eol(), a.list(w, a.atendtok, a._linenumber_item), a.val('.end'), a.val('linenumbertable')
        } else if (a.tryv('.localvariabletable')) {
            ;[attr, w] = create('LocalVariableTable')
            a.eol(), a.list(w, a.atendtok, a._localvariabletable_item), a.val('.end'), a.val('localvariabletable')
        } else if (a.tryv('.localvariabletypetable')) {
            ;[attr, w] = create('LocalVariableTypeTable') // reuse _localvariabletable_item func
            a.eol(), a.list(w, a.atendtok, a._localvariabletable_item), a.val('.end'), a.val('localvariabletypetable')
        } else if (a.tryv('.methodparameters')) {
            ;[attr, w] = create('MethodParameters')
            a.eol(), a.list(w, a.atendtok, a._methodparams_item), a.val('.end'), a.val('methodparameters')
        } else if (a.tryv('.runtime')) {
            if (!a.hasany(['visible', 'invisible'])) {
                a.fail()
            }

            const temp = a.consume().val
            const prefix = 'Runtime' + temp[0].toUpperCase() + temp.slice(1)

            if (a.tryv('annotations')) {
                ;[attr, w] = create(prefix + 'Annotations')
                a.eol(), a.list(w, a.atendtok, a.annotation_line)
            } else if (a.tryv('paramannotations')) {
                ;[attr, w] = create(prefix + 'ParameterAnnotations')
                a.eol(), a.listu8(w, a.atendtok, a.param_annotation_line)
            } else if (a.tryv('typeannotations')) {
                ;[attr, w] = create(prefix + 'TypeAnnotations')
                a.eol(), a.list(w, a.atendtok, a.type_annotation_line)
            } else {
                a.fail()
            }
            a.val('.end'), a.val('runtime')
        } else if (a.code !== null && a.tryv('.stackmaptable')) {
            ;[attr, w] = create('StackMapTable')
            a.code.stackmaptable = wrapper_attr || attr
        } else if (a.tryv('.signature')) {
            ;[attr, w] = create('Signature')
            w.ref(a.utfref())
        } else if (a.tryv('.sourcedebugextension')) {
            ;[attr, w] = create('SourceDebugExtension')
            w.writeBytes(a.string(0xFFFFFFFF))
        } else if (a.tryv('.sourcefile')) {
            ;[attr, w] = create('SourceFile')
            w.ref(a.utfref())
        } else if (a.tryv('.synthetic')) {
            ;[attr, w] = create('Synthetic')
        } else {
            return null
        }
        return attr
    }

    _exceptions_item(w) {
        const a = this
        w.ref(a.clsref())
    }
    _innerclasses_item(w) {
        const a = this
        w.ref(a.clsref()), w.ref(a.clsref()), w.ref(a.utfref()), w.u16(a.flags()), a.eol()
    }
    _linenumber_item(w) {
        const a = this
        w.lbl(a.lbl(), 0, 'u16'), w.u16(a.u16()), a.eol()
    }
    _methodparams_item(w) {
        const a = this
        w.ref(a.utfref()), w.u16(a.flags()), a.eol()
    }

    _localvariabletable_item(w) {
        const a = this
        const [ind, , name, desc, _range, ] = [a.u16(), a.val('is'), a.utfref(), a.utfref(), a.code_range(), a.eol()]
        w.lblrange(..._range), w.ref(name), w.ref(desc), w.u16(ind)
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    ////// Annotations //////////////////////////////////////////////////////////////////////
    annotation_line(w) {
        const a = this
        a.val('.annotation'), a.annotation_contents(w), a.val('.end'), a.val('annotation'), a.eol()
    }

    param_annotation_line(w) {
        const a = this
        a.val('.paramannotation'), a.eol()
        a.list(w, a.atendtok, a.annotation_line)
        a.val('.end'), a.val('paramannotation'), a.eol()
    }

    type_annotation_line(w) {
        const a = this
        a.val('.typeannotation'), a.ta_target_info(w), a.ta_target_path(w)
        a.annotation_contents(w), a.val('.end'), a.val('typeannotation'), a.eol()
    }

    ta_target_info(w) {
        const a = this
        w.u8(a.u8())
        if (a.tryv('typeparam')) {
            w.u8(a.u8())
        } else if (a.tryv('super')) {
            w.u16(a.u16())
        } else if (a.tryv('typeparambound')) {
            w.u8(a.u8()), w.u8(a.u8())
        } else if (a.tryv('empty')) {
        } else if (a.tryv('methodparam')) {
            w.u8(a.u8())
        } else if (a.tryv('throws')) {
            w.u16(a.u16())
        } else if (a.tryv('localvar')) {
            a.eol()
            a.list(w, a.atendtok, a._localvarrange)
            a.val('.end'), a.val('localvar')
        } else if (a.tryv('catch')) {
            w.u16(a.u16())
        } else if (a.tryv('offset')) {
            w.lbl(a.lbl(), 0, 'u16')
        } else if (a.tryv('typearg')) {
            w.lbl(a.lbl(), 0, 'u16'), w.u8(a.u8())
        } else {
            a.fail()
        }
        a.eol()
    }

    _localvarrange(w) {
        const a = this
        if (a.tryv('nowhere')) { // WTF, Java?
            w.u16(0xFFFF), w.u16(0xFFFF)
        } else {
            w.lblrange(...a.code_range())
        }
        w.u16(a.u16()), a.eol()
    }

    ta_target_path(w) {
        const a = this
        a.val('.typepath'), a.eol()
        a.listu8(w, a.atendtok, a._type_path_segment)
        a.val('.end'), a.val('typepath'), a.eol()
    }

    _type_path_segment(w) {
        const a = this
        w.u8(a.u8()), w.u8(a.u8()), a.eol()
    }

    // The following are recursive && can be nested arbitrarily deep,
    // so we use generators && a thunk to avoid the Python stack limit.
    element_value(w) {
        const a = this
        thunk(a._element_value(w))
    }
    annotation_contents(w) {
        const a = this
        thunk(a._annotation_contents(w))
    }

    *_element_value(w) {
        const a = this
        if (!a.hasany(codes.et_tags)) {
            a.fail()
        }

        const tag = a.consume().val
        w.u8(codes.et_tags.get(tag))
        if (tag === 'annotation') {
            ;(yield a._annotation_contents(w)), a.val('.end'), a.val('annotation')
        } else if (tag === 'array') {
            a.eol()
            let [count, pos] = [0, w.ph16()]
            while (!a.atendtok()) {
                if (count >= 65535) {
                    a.error(`Maximum 65535 items in annotation array element.`, a.tok)
                }
                count += 1
                ;(yield a._element_value(w)), a.eol()
            }
            w.setph16(pos, count)
            a.val('.end'), a.val('array')
        } else if (tag === 'enum') {
            w.ref(a.utfref()), w.ref(a.utfref())
        } else if (tag === 'class' || tag === 'string') {
            w.ref(a.utfref())
        } else {
            w.ref(a.ldc_rhs())
        }
    }

    *_annotation_contents(w) {
        const a = this
        w.ref(a.utfref()), a.eol()
        let [count, pos] = [0, w.ph16()]
        while (!a.atendtok()) {
            if (count >= 65535) {
                a.error(`Maximum 65535 items in annotation.`, a.tok)
            }
            count += 1
            w.ref(a.utfref()), a.val('='), (yield a._element_value(w)), a.eol()
        }
        w.setph16(pos, count)
    }
}

function* assemble(source) {
    const tokenizer = new Tokenizer(source)
    try {
        while (!tokenizer.atend()) {
            yield [true, new Parser(tokenizer).parseClass()]
        }
    }
    catch(e) {
        if (e instanceof AssemblerError) {
            yield [false, e]
        } else {
            throw e
        }
    }
}

module.exports = {assemble}




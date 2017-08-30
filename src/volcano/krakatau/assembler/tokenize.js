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
const {range} = require('../std')

const res = require('./token_regexes')

class AssemblerError {
    constructor(args) {this.args = args}

    toString() {
        const {source, error, notes} = this.args
        return JSON.stringify([error, ...notes].map(([message, pos, pos2]) => {
            const line = source.slice(0, pos).split('\n').length
            return [message, line, source.slice(pos, pos2), pos, pos2]
        }))
    }

    format([message, pos, pos2], MAXLINELEN=80) {
        const source = this.args.source
        let start = source.slice(0, pos).lastIndexOf('\n') + 1
        const line_start = start

        const ei = source.slice(start).indexOf('\n')
        let end = ei !== -1 ? ei + start + 1 : source.length + 1

        // Find an 80 char section of the line around the point of interest to display
        let temp = Math.min(pos2, ~~(pos + MAXLINELEN / 2))
        if (temp < start + MAXLINELEN) {
            end = Math.min(end, start + MAXLINELEN)
        } else if (pos >= end - MAXLINELEN) {
            start = Math.max(start, end - MAXLINELEN)
        } else {
            const mid = ~~((pos + temp) / 2)
            start = Math.max(start, mid - ~~(MAXLINELEN / 2))
            end = Math.min(end, start + MAXLINELEN)
        }

        pos2 = Math.min(pos2, end)

        const line = source.slice(0, line_start).split('\n').length
        const col = pos - line_start + 1
        const snippet = source.slice(start, end).replace(/\n+$/, '') // strip trailing newlines
        const markers = ' '.repeat(pos - start) + '^' + '-'.repeat(Math.max(pos2 - pos - 1, 0)) + ' '.repeat(end - pos2)
        return {pos, pos2, start, end, line, col, message, snippet, markers}
    }
}

const Token = (type, val, pos) => Object.freeze({type, val, pos})

const REGEXES = [
    ['WHITESPACE', String.raw`[ \t]+`],
    ['WORD', res.WORD + res.FOLLOWED_BY_WHITESPACE],
    ['DIRECTIVE', res.DIRECTIVE + res.FOLLOWED_BY_WHITESPACE],
    ['LABEL_DEF', res.LABEL_DEF + res.FOLLOWED_BY_WHITESPACE],
    ['NEWLINES', res.NEWLINES],
    ['REF', res.REF + res.FOLLOWED_BY_WHITESPACE],
    ['COLON', ':' + res.FOLLOWED_BY_WHITESPACE],
    ['EQUALS', '=' + res.FOLLOWED_BY_WHITESPACE],
    ['INT_LITERAL', res.INT_LITERAL + res.FOLLOWED_BY_WHITESPACE],
    ['DOUBLE_LITERAL', res.FLOAT_LITERAL + res.FOLLOWED_BY_WHITESPACE],
    ['STRING_LITERAL', res.STRING_LITERAL + res.FOLLOWED_BY_WHITESPACE],
].map(([type, re]) => ({type, re: new RegExp('^' + re)}))

const STRING_START_REGEX = new RegExp('^' + res.STRING_START)
const WORD_LIKE_REGEX = new RegExp(String.raw`^.\S*`)

class Tokenizer {
    constructor(source) {
        this.s = source
        this.pos = 0
        this.atlineend = true
    }

    error(error, ...notes) {
        throw new AssemblerError({source: this.s, error, notes})
    }

    _nextsub() {
        const s = this.s.slice(this.pos)
        const start = this.pos
        let group = null
        let end

        for (let {type, re} of REGEXES) {
            const m = s.match(re)
            if (m !== null) {
                group = type
                end = this.pos + m[0].length
                // console.log(this.pos, m[0], m[0].length, end)
                break
            }
        }

        if (group) {
            this.pos = end
            // console.log('match', group, JSON.stringify(this.s.slice(start, end)))
            return Token(group, this.s.slice(start, end), start)
        }

        // TODO
        console.assert(typeof start === 'number')
        console.assert(group === null || typeof end === 'number')
        console.assert(typeof this.pos === 'number')

        // no match
        if (this.atend()) {
            return Token('EOF', '', start)
        } else {
            const str_match = s.match(STRING_START_REGEX)
            if (str_match !== null) {
                const end = start + str_match[0].length
                this.error(['Invalid escape sequence or character in string literal', end, end+1])
            }

            const match = s.match(WORD_LIKE_REGEX)
            return Token('INVALID_TOKEN', match[0], start)
        }
    }

    next() {
        let tok = this._nextsub()
        while (tok.type === 'WHITESPACE' || this.atlineend && tok.type === 'NEWLINES') {
            tok = this._nextsub()
        }
        this.atlineend = tok.type === 'NEWLINES'

        if (tok.type === 'INT_LITERAL' && tok.val.toLowerCase().endsWith('l')) {
            return Token('LONG_LITERAL', tok.val, tok.pos)
        }
        if (tok.type === 'DOUBLE_LITERAL' && tok.val.toLowerCase().endsWith('f')) {
            return Token('FLOAT_LITERAL', tok.val, tok.pos)
        }
        return tok
    }

    atend() {return this.pos === this.s.length}
}

module.exports = {Tokenizer, AssemblerError}

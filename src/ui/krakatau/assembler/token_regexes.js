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
const DIRECTIVE = String.raw`\.[a-z]+`
const WORD = String.raw`(?:[a-zA-Z_$\(<]|\[[A-Z\[])[\w$;\/\[\(\)<>*+-]*`
const FOLLOWED_BY_WHITESPACE = String.raw`(?=\s|$)`
const REF = String.raw`\[[a-z0-9_:]+\]`
const LABEL_DEF = String.raw`L\w+:`

const COMMENT = String.raw`;.*`
//Match optional comment and at least one newline, followed by any number of empty/whitespace lines
const NEWLINES = String.raw`(?:${COMMENT})?\n\s*`

const HEX_DIGIT = String.raw`[0-9a-fA-F]`
const ESCAPE_SEQUENCE = String.raw`\\(?:U00(?:10|0${HEX_DIGIT})${HEX_DIGIT}{4}|u${HEX_DIGIT}{4}|x${HEX_DIGIT}{2}|[btnfr'"\\0-7])`
//See http://stackoverflow.com/questions/430759/regex-for-managing-escaped-characters-for-items-like-string-literals/5455705//5455705
const STRING_LITERAL = String.raw`[bB]?(?:"[^"\n\\]*(?:${ESCAPE_SEQUENCE}[^"\n\\]*)*"|'[^'\n\\]*(?:${ESCAPE_SEQUENCE}[^'\n\\]*)*')`
//For error detection
const STRING_START = String.raw`[bB]?(?:"(?:[^"\\\n]|${ESCAPE_SEQUENCE})*|'(?:[^'\\\n]|${ESCAPE_SEQUENCE})*)`

//Careful here: | is not greedy so hex must come first
const INT_LITERAL = String.raw`[+-]?(?:0[xX]${HEX_DIGIT}+|[1-9][0-9]*|0)[lL]?`
const FLOAT_LITERAL = String.raw`(?:(?:[-+][Ii][Nn][Ff][Ii][Nn][Ii][Tt][Yy]|[-+][Nn][Aa][Nn](?:<0[xX]${HEX_DIGIT}+>)?)|[-+]?(?:\d+\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+|0[xX]${HEX_DIGIT}+(?:\.${HEX_DIGIT}+)?[pP][+-]?\d+))[fF]?`

module.exports = {DIRECTIVE, WORD, FOLLOWED_BY_WHITESPACE, REF, LABEL_DEF, NEWLINES, STRING_LITERAL, STRING_START, INT_LITERAL, FLOAT_LITERAL}

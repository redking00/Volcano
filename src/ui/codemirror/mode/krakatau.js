// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
    if (typeof exports === "object" && typeof module === "object") // CommonJS
        mod(require("../lib/codemirror"));
    else if (typeof define === "function" && define.amd) // AMD
        define(["../lib/codemirror"], mod);
    else // Plain browser env
        mod(CodeMirror);
})(function(CodeMirror) {
    "use strict";

    CodeMirror.defineMode("krakatau", function(_config, parserConfig) {
        'use strict';

        let debug = false;

        const lex = {
            'CPREF'               :/(\[([0-9]+|[a-z][a-z0-9_]*)])/,
            'BSREF'               :/(\[bs:([0-9]+|[a-z][a-z0-9_]*)])/,
            'WORD'                :/([a-zA-Z_$(<[][a-zA-Z_$(<[0-9)>/;*+-]*)/,
            'STR_LITERAL'         :/([bB]?(?:"[^"\n\\]*(?:\\(?:U00(?:10|0[0-9a-fA-F])[0-9a-fA-F]{{4}}|u[0-9a-fA-F]{{4}}|x[0-9a-fA-F]{{2}}|[btnfr'"\\0-7])[^"\n\\]*)*"|'[^'\n\\]*(?:\\(?:U00(?:10|0[0-9a-fA-F])[0-9a-fA-F]{{4}}|u[0-9a-fA-F]{{4}}|x[0-9a-fA-F]{{2}}|[btnfr'"\\0-7])[^'\n\\]*)*'))/,
            'INT_LITERAL'         :/([+-]?(0[xX][0-9a-fA-F]+|[1-9][0-9]*|0))\b/,
            'NAT_LITERAL'         :/((0[xX][0-9a-fA-F]+|[1-9][0-9]*|0)[lL]?)\b/,
            'LONG_LITERAL'        :/([+-]?(0[xX][0-9a-fA-F]+|[1-9][0-9]*|0)[lL]?)\b/,
            'FLOAT_LITERAL'       :/((([-+][Ii][Nn][Ff][Ii][Nn][Ii][Tt][Yy]|[-+][Nn][Aa][Nn](<0[xX][0-9a-fA-F]+>)?)|[-+]?(\d+\.\d+([eE][+-]?\d+)?|\d+[eE][+-]?\d+|0[xX][0-9a-fA-F]+(\.[0-9a-fA-F]+)?[pP][+-]?\d+))[fF]?)\b/,
            'DOUBLE_LITERAL'      :/(([-+][Ii][Nn][Ff][Ii][Nn][Ii][Tt][Yy]|[-+][Nn][Aa][Nn](<0[xX][0-9a-fA-F]+>)?)|[-+]?(\d+\.\d+([eE][+-]?\d+)?|\d+[eE][+-]?\d+|0[xX][0-9a-fA-F]+(\.[0-9a-fA-F]+)?[pP][+-]?\d+))\b/,
            'ident'               :/([a-zA-Z_$(<[][a-zA-Z_$(<[0-9)>/;*+-]*)|("[^"]*"|'[^']*')/,
            'clsref'              :/(\[([0-9]+|[a-z][a-z0-9_]*)])|([a-zA-Z_$(<[][a-zA-Z_$(<[0-9)>/;*+-]*)|("[^"]*"|'[^']*')/,
            'utfref'              :/(\[([0-9]+|[a-z][a-z0-9_]*)])|([a-zA-Z_$(<[][a-zA-Z_$(<[0-9)>/;*+-]*)|("[^"]*"|'[^']*')/,

            'label'               :/(L[a-zA-Z_$(<[0-9)>\/;*+,-]+)\b/,
            'labeldef'            :/(L[a-zA-Z_$(<[0-9)>\/;*+,-]+):/,

            'class'               :/Class\b/,
            'methodtype'          :/MethodType\b/,
            'methodhandle'        :/MethodHandle\b/,
            'handlecode'          :/getField|getStatic|putField|putStatic|invokeVirtual|invokeStatic|invokeSpecial|newInvokeSpecial|invokeInterface/,
            'fmim_tag'            :/Field|Method|InterfaceMethod/,
            'prim_tag'            :/byte|char|double|int|float|long|short|boolean/,
            'i_tag'               :/Integer|Int/,
            'l_tag'               :/Long/,
            'f_tag'               :/Float/,
            'd_tag'               :/Double/,
            's_tag'               :/String/,
            'utf8'                :/Utf8/,
            'nameandtype'         :/NameAndType/,
            'invdyn_tag'          :/InvokeDynamic/,

            'default'             :/default\b/,

            'eq'                  :/=/,
            'colon'               :/:/,
            'comment'             :/;\s*\S*(\s+\S+)*/,
            '_version'            :/\.version\b/,
            '_class'              :/\.class\b/,
            '_super'              :/\.super\b/,
            '_implements'         :/\.implements\b/,
            '_field'              :/\.field\b/,
            '_fieldattr'          :/\.fieldattributes\b/,
            '_signature'          :/\.signature\b/,
            '_annotation'         :/\.annotation\b/,
            '_annotationdef'      :/\.annotationdefault\b/,
            '_lntable'            :/\.linenumbertable\b/,
            '_lvartable'          :/\.localvariabletable\b/,
            '_lvarttable'         :/\.localvariabletypetable\b/,
            '_end'                :/\.end\b/,
            '_exceptions'         :/\.exceptions\b/,
            '_code'               :/\.code\b/,
            '_stack'              :/\.stack\b/,
            '_stackmaptable'      :/\.stackmaptable\b/,
            '_methodparams'       :/\.methodparameters\b/,
            '_method'             :/\.method\b/,
            '_bsmethods'          :/\.bootstrapmethods\b/,
            '_innerclasses'       :/\.innerclasses\b/,
            '_sourcefile'         :/\.sourcefile\b/,
            '_srcdebugext'        :/\.sourcedebugextension\b/,
            '_deprecated'         :/\.deprecated\b/,
            '_runtime'            :/\.runtime\b/,
            '_const'              :/\.const\b/,
            '_constantvalue'      :/\.constantvalue\b/,
            '_catch'              :/\.catch\b/,
            '_enclosing'          :/\.enclosing\b/,
            '_synthetic'          :/\.synthetic\b/,
            'method'              :/method\b/,
            'from'                :/from\b/,
            'to'                  :/to\b/,
            'using'               :/using\b/,
            'is'                  :/is\b/,
            'visibility'          :/(invisible|visible)\b/,
            'annotations'         :/(paramannotations|typeannotations|annotations)\b/,
            'full'                :/full\b/,
            'same'                :/(same_extended|same)\b/,
            'chop'                :/chop\b/,
            'stack_1'             :/(stack_1_extended|stack_1)\b/,
            'vertypec'            :/(Top|Integer|Float|Double|Long|Null|UninitializedThis)\b/,
            'vertypeo'            :/Object\b/,
            'vertypeu'            :/Uninitialized\b/,
            'append'              :/append\b/,
            'stack'               :/stack\b/,
            'locals'              :/locals\b/,
            'flag'                :/(public|private|protected|static|final|super|synchronized|volatile|bridge|transient|varargs|native|interface|abstract|strict|synthetic|annotation|enum|mandated)\b/,

            'ins_newarray'        :/newarray/,
            'nacode'              :/boolean|char|float|double|byte|short|int|long/,
            'op_none'             :/nop|aconst_null|iconst_m1|iconst_0|iconst_1|iconst_2|iconst_3|iconst_4|iconst_5|lconst_0|lconst_1|fconst_0|fconst_1|fconst_2|dconst_0|dconst_1|iload_0|iload_1|iload_2|iload_3|lload_0|lload_1|lload_2|lload_3|fload_0|fload_1|fload_2|fload_3|dload_0|dload_1|dload_2|dload_3|aload_0|aload_1|aload_2|aload_3|iaload|laload|faload|daload|aaload|baload|caload|saload|istore_0|istore_1|istore_2|istore_3|lstore_0|lstore_1|lstore_2|lstore_3|fstore_0|fstore_1|fstore_2|fstore_3|dstore_0|dstore_1|dstore_2|dstore_3|astore_0|astore_1|astore_2|astore_3|iastore|lastore|fastore|dastore|aastore|bastore|castore|sastore|pop2|pop|dup_x1|dup_x2|dup2|dup2_x1|dup2_x2|dup|swap|iadd|ladd|fadd|dadd|isub|lsub|fsub|dsub|imul|lmul|fmul|dmul|idiv|ldiv|fdiv|ddiv|irem|lrem|frem|drem|ineg|lneg|fneg|dneg|ishl|lshl|ishr|lshr|iushr|lushr|iand|land|ior|lor|ixor|lxor|i2l|i2f|i2d|l2i|l2f|l2d|f2i|f2l|f2d|d2i|d2l|d2f|i2b|i2c|i2s|lcmp|fcmpl|fcmpg|dcmpl|dcmpg|ireturn|lreturn|freturn|dreturn|areturn|return|arraylength|athrow|monitorenter|monitorexit/,
            'op_short'            :/iload|lload|fload|dload|aload|istore|lstore|fstore|dstore|astore|ret/,
            'op_lbl'              :/ifeq|ifne|iflt|ifge|ifgt|ifle|if_icmpeq|if_icmpne|if_icmplt|if_icmpge|if_icmpgt|if_icmple|if_acmpeq|if_acmpne|goto|jsr|ifnull|ifnonnull|goto_w|jsr_w/,
            'op_cls'              :/anewarray|new|checkcast|instanceof/,
            'op_bipush'           :/bipush/,
            'op_sipush'           :/sipush/,
            'op_iinc'             :/iinc/,
            'op_ldc'              :/ldc_w|ldc2_w|ldc/,
            'op_cls_int'          :/multianewarray/,
            'op_fmim'             :/getstatic|putstatic|getfield|putfield|invokevirtual|invokespecial|invokestatic/,
            'op_invint'           :/invokeinterface/,

            'tableswitch'         :/tableswitch/,
            'lookupswitch'        :/lookupswitch/,
            'wide'                :/wide/,

        };

        const rules = [

            {
                id:'COMMENT', tokens:[
        /* 0  */    { exp:lex.comment       ,type:'comment' }
                ]
            },

            {
                id:'VERSION', tokens:[
        /* 0  */    { exp:lex._version      ,type:'directive' },
        /* 1  */    { exp:lex.NAT_LITERAL   ,type:'number' },
        /* 2  */    { exp:lex.NAT_LITERAL   ,type:'number' },
                ]
            },

            {
                id:'CLASS', tokens:[
        /* 0  */    { exp:lex._class        ,type:'directive' },
        /* 1  */    { exp:lex.flag          ,type:'flag'        ,opt:true       ,goto:0 },
        /* 2  */    { exp:lex.clsref        ,type:'classname' },
                ]
            },

            {
                id:'SUPER', tokens:[
        /* 0  */    { exp:lex._super        ,type:'directive' },
        /* 1  */    { exp:lex.clsref        ,type:'classname2' },
                ]
            },

            {
                id:'IMPLEMENTS', tokens:[
        /* 0  */    { exp:lex._implements   ,type:'directive' },
        /* 1  */    { exp:lex.clsref        ,type:'classname2' },
                ]
            },

            {
                id:'FIELD', tokens:[
        /* 0  */    { exp:lex._field        ,type:'directive' },
        /* 1  */    { exp:lex.flag          ,type:'flag'        ,opt:true       ,goto:0 },
        /* 2  */    { exp:lex.utfref        ,type:'fieldname' },
        /* 3  */    { exp:lex.utfref        ,type:'fieldtype' },
        /* 4  */    { exp:lex.eq            ,type:'operator'    ,opt:true       ,spaced:true },
        /* 5  */    { exp:lex.CPREF         ,type:'atom'        ,opt:true       ,if:-1          ,goto:17 },
        /* 6  */    { exp:lex.FLOAT_LITERAL ,type:'number'      ,opt:true       ,if:-2          ,goto:16 },
        /* 7  */    { exp:lex.LONG_LITERAL  ,type:'number'      ,opt:true       ,if:-3          ,goto:15 },
        /* 8  */    { exp:lex.INT_LITERAL   ,type:'number'      ,opt:true       ,if:-4          ,goto:14 },
        /* 9  */    { exp:lex.STR_LITERAL   ,type:'string'      ,opt:true       ,if:-5          ,goto:13 },
        /* 10 */    { exp:lex.class         ,type:'keyword'     ,opt:true       ,if:-6 },
        /* 11 */    { exp:lex.utfref        ,type:'classname2'  ,if:-1          ,goto:11        ,spaced:true },
        /* 12 */    { exp:lex.methodtype    ,type:'keyword'     ,opt:true       ,if:-8 },
        /* 13 */    { exp:lex.utfref        ,type:'fieldname'   ,if:-1          ,goto:9         ,spaced:true },
        /* 14 */    { exp:lex.methodhandle  ,type:'keyword'     ,if:-10 },
        /* 15 */    { exp:lex.handlecode    ,type:'keyword'     ,if:-1          ,spaced:true },
        /* 16 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-2          ,goto:6     ,spaced:true },
        /* 17 */    { exp:lex.fmim_tag      ,type:'keyword'     ,if:-3          ,spaced:true },
        /* 18 */    { exp:lex.clsref        ,type:'classname2'  ,if:-4          ,spaced:true },
        /* 19 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-5          ,goto:3     ,spaced:true },
        /* 20 */    { exp:lex.ident         ,type:'fieldname'   ,if:-6          ,spaced:true },
        /* 21 */    { exp:lex.utfref        ,type:'fieldtype'   ,if:-7          ,spaced:true },
        /* 22 */    { exp:lex._fieldattr    ,type:'directive'   ,opt:true       ,spaced:true    ,pushctx:'fieldattributes'}
                ]
            },

            {
                id:'END', tokens:[
                    { exp:lex._end                  ,type:'directive' },
                    { exp:/linenumbertable\b/       ,type:'directive'   ,opt:true   ,spaced:true    ,popctx:'linenumbertable'       ,goto:100 },
                    { exp:/innerclasses\b/          ,type:'directive'   ,opt:true   ,spaced:true    ,popctx:'innerclasses'          ,goto:100 },
                    { exp:/localvariabletable\b/    ,type:'directive'   ,opt:true   ,spaced:true    ,popctx:'localvariabletable'    ,goto:100 },
                    { exp:/localvariabletypetable\b/,type:'directive'   ,opt:true   ,spaced:true    ,popctx:'localvariabletypetable',goto:100 },
                    { exp:/annotation\b/            ,type:'directive'   ,opt:true   ,spaced:true    ,popctx:'annotation'            ,goto:100 },
                    { exp:/stack\b/                 ,type:'directive'   ,opt:true   ,spaced:true    ,popctx:'stack'                 ,goto:100 },
                    { exp:/methodparameters\b/      ,type:'directive'   ,opt:true   ,spaced:true    ,popctx:'methodparameters'      ,goto:100 },
                    { exp:/method\b/                ,type:'directive'   ,opt:true   ,spaced:true    ,goto:100 },
                    { exp:/code\b/                  ,type:'directive'   ,opt:true   ,spaced:true    ,goto:100 },
                    { exp:/class\b/                 ,type:'directive'   ,opt:true   ,spaced:true    ,goto:100 },
                    { exp:/fieldattributes\b/       ,type:'directive'   ,opt:true   ,spaced:true    ,popctx:'fieldattributes'       ,goto:100 },
                    { exp:/runtime\b/               ,type:'directive'               ,spaced:true    ,popctx:'runtime' },
                ]
            },

            {
                id:'ANNOTATION', tokens:[
        /* 0  */    { exp:lex._annotation   ,type:'directive'       ,pushctx:'annotation'},
        /* 1  */    { exp:lex.utfref        ,type:'fieldtype'       ,spaced:true },
                ]
            },

            {
                id:'LINENUMBERTABLE_ITEM', chkctx:'linenumbertable', tokens:[
                /* 0  */    { exp:lex.label         ,type:'atom' },
                /* 1  */    { exp:lex.NAT_LITERAL   ,type:'number'      ,opt:true       ,spaced:true },
            ]
            },

            {
                id:'LOCALVARIABLETABLE_ITEM', chkctx:'localvariabletable', tokens:[
        /* 0  */    { exp:lex.NAT_LITERAL   ,type:'directive' },
        /* 1  */    { exp:lex.is            ,type:'keyword'     ,spaced:true },
        /* 2  */    { exp:lex.utfref        ,type:'fieldname'   ,spaced:true },
        /* 3  */    { exp:lex.utfref        ,type:'fieldtype'   ,spaced:true },
        /* 4  */    { exp:lex.from          ,type:'keyword'     ,spaced:true },
        /* 5  */    { exp:lex.label         ,type:'atom'        ,spaced:true },
        /* 6  */    { exp:lex.to            ,type:'keyword'     ,spaced:true },
        /* 7  */    { exp:lex.label         ,type:'atom'        ,spaced:true },
                ]
            },

            {
                id:'LOCALVARIABLETYPETABLE_ITEM', chkctx:'localvariabletypetable', tokens:[
        /* 0  */    { exp:lex.NAT_LITERAL   ,type:'directive' },
        /* 1  */    { exp:lex.is            ,type:'keyword'     ,spaced:true },
        /* 2  */    { exp:lex.utfref        ,type:'fieldname'   ,spaced:true },
        /* 3  */    { exp:lex.utfref        ,type:'fieldtype'   ,spaced:true },
        /* 4  */    { exp:lex.from          ,type:'keyword'     ,spaced:true },
        /* 5  */    { exp:lex.label         ,type:'atom'        ,spaced:true },
        /* 6  */    { exp:lex.to            ,type:'keyword'     ,spaced:true },
        /* 7  */    { exp:lex.label         ,type:'atom'        ,spaced:true },
                ]
            },

            {
                id:'INNERCLASSES_ITEM', chkctx:'innerclasses', tokens:[
        /* 0  */    { exp:lex.clsref    ,type:'classname2' },
        /* 1  */    { exp:lex.clsref    ,type:'classname2'      ,spaced:true },
        /* 2  */    { exp:lex.utfref    ,type:'fieldname'       ,spaced:true },
        /* 3  */    { exp:lex.flag      ,type:'flag'            ,opt:true       ,goto:0     ,spaced:true },
                ]
            },

            {
                id:'STACK', tokens:[
        /* 0  */    { exp:lex._stack        ,type:'directive'   },
        /* 1  */    { exp:lex.full          ,type:'directive'   ,opt:true       ,goto:100       ,pushctx:'stack'},
        /* 2  */    { exp:lex.same          ,type:'directive'   ,opt:true       ,goto:100 },
        /* 3  */    { exp:lex.chop          ,type:'directive'   ,opt:true },
        /* 4  */    { exp:lex.NAT_LITERAL   ,type:'number'      ,if:-1          ,goto:100 },
        /* 5  */    { exp:lex.stack_1       ,type:'directive'   ,opt:true },
        /* 6  */    { exp:lex.vertypec      ,type:'keyword'     ,opt:true       ,if:-1          ,goto:100 },
        /* 7  */    { exp:lex.vertypeo      ,type:'keyword'     ,opt:true       ,if:-2 },
        /* 8  */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,goto:100       ,spaced:true },
        /* 9  */    { exp:lex.vertypeu      ,type:'keyword'     ,if:-4 },
        /* 10 */    { exp:lex.label         ,type:'atom'        ,if:-1          ,goto:100       ,spaced:true },
        /* 11 */    { exp:lex.append        ,type:'directive'   },
        /* 12 */    { exp:lex.vertypec      ,type:'keyword'     ,opt:true       ,if:-1          ,goto:5 },
        /* 13 */    { exp:lex.vertypeo      ,type:'keyword'     ,opt:true       ,if:-2 },
        /* 14 */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,goto:3         ,spaced:true },
        /* 15 */    { exp:lex.vertypeu      ,type:'keyword'     ,if:-4 },
        /* 16 */    { exp:lex.label         ,type:'atom'        ,if:-1          ,goto:1         ,spaced:true },
        /* 17 */    { exp:lex.vertypec      ,type:'keyword'     ,opt:true       ,if:-6          ,goto:5 },
        /* 18 */    { exp:lex.vertypeo      ,type:'keyword'     ,opt:true       ,if:-7 },
        /* 19 */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,goto:3         ,spaced:true },
        /* 20 */    { exp:lex.vertypeu      ,type:'keyword'     ,opt:true       ,if:-9 },
        /* 21 */    { exp:lex.label         ,type:'atom'        ,if:-1          ,goto:1         ,spaced:true },
        /* 22 */    { exp:lex.vertypec      ,type:'keyword'     ,opt:true       ,if:-11         ,goto:5 },
        /* 23 */    { exp:lex.vertypeo      ,type:'keyword'     ,opt:true       ,if:-12 },
        /* 24 */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,goto:3         ,spaced:true },
        /* 25 */    { exp:lex.vertypeu      ,type:'keyword'     ,opt:true       ,if:-14 },
        /* 26 */    { exp:lex.label         ,type:'atom'        ,if:-1          ,goto:1         ,spaced:true },

                ]
            },
            {
                id:'STACK_FULL_LOCALS', chkctx:'stack', tokens:[
        /* 0  */    { exp:lex.locals        ,type:'keyword'   },
        /* 1  */    { exp:lex.vertypec      ,type:'keyword'     ,opt:true       ,goto:0 },
        /* 2  */    { exp:lex.vertypeo      ,type:'keyword'     ,opt:true },
        /* 3  */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,spaced:true        ,goto:-2 },
        /* 4  */    { exp:lex.vertypeu      ,type:'keyword'     ,opt:true },
        /* 5  */    { exp:lex.label         ,type:'atom'        ,if:-1          ,goto:-4            ,spaced:true },
                ]
            },
            {
                id:'STACK_FULL_STACK', chkctx:'stack', tokens:[
        /* 0  */    { exp:lex.stack         ,type:'keyword'   },
        /* 1  */    { exp:lex.vertypec      ,type:'keyword'     ,opt:true       ,goto:0 },
        /* 2  */    { exp:lex.vertypeo      ,type:'keyword'     ,opt:true },
        /* 3  */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,spaced:true        ,goto:-2 },
        /* 4  */    { exp:lex.vertypeu      ,type:'keyword'     ,opt:true },
        /* 5  */    { exp:lex.label         ,type:'atom'        ,if:-1          ,goto:-4            ,spaced:true },
                ]
            },

            {
                id:'METHODPARAMETERS_ITEM', chkctx:'methodparameters', tokens:[
        /* 0  */    { exp:lex.utfref        ,type:'fieldname' },
        /* 1  */    { exp:lex.flag          ,type:'flag'        ,opt:true       ,goto:0 },
                ]
            },

            {
                id:'METHOD', tokens:[
        /* 0  */    { exp:lex._method       ,type:'directive' },
        /* 1  */    { exp:lex.flag          ,type:'flag'        ,opt:true       ,goto:0 },
        /* 2  */    { exp:lex.utfref        ,type:'fieldname'   ,spaced:true },
        /* 3  */    { exp:lex.colon         ,type:'symbol'      ,spaced:true },
        /* 4  */    { exp:lex.utfref        ,type:'fieldtype'   ,spaced:true },
                ]
            },

            {
                id:'OP', tokens:[
        /* 0  */    { exp:lex.labeldef      ,type:'atom'        ,opt:true },

        /* 1  */    { exp:lex.op_none       ,type:'op'          ,opt:true       ,goto:100 },

        /* 2  */    { exp:lex.op_short      ,type:'op'          ,opt:true },
        /* 3  */    { exp:lex.NAT_LITERAL   ,type:'number'      ,if:-1          ,spaced:true    ,goto:100 },

        /* 4  */    { exp:lex.op_lbl        ,type:'op'          ,opt:true },
        /* 5  */    { exp:lex.label         ,type:'atom'        ,if:-1          ,spaced:true    ,goto:100 },

        /* 6  */    { exp:lex.ins_newarray  ,type:'op'          ,opt:true },
        /* 7  */    { exp:lex.nacode        ,type:'atom'        ,if:-1          ,spaced:true    ,goto:100 },

        /* 8  */    { exp:lex.op_cls        ,type:'op'          ,opt:true },
        /* 9  */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,spaced:true    ,goto:100 },

        /* 10 */    { exp:lex.op_bipush     ,type:'op'          ,opt:true },
        /* 11 */    { exp:lex.INT_LITERAL   ,type:'number'      ,if:-1          ,spaced:true    ,goto:100 },

        /* 12 */    { exp:lex.op_sipush     ,type:'op'          ,opt:true },
        /* 13 */    { exp:lex.INT_LITERAL   ,type:'number'      ,if:-1          ,spaced:true    ,goto:100 },

        /* 14 */    { exp:lex.op_iinc       ,type:'op'          ,opt:true },
        /* 15 */    { exp:lex.NAT_LITERAL   ,type:'number'      ,if:-1          ,spaced:true },
        /* 16 */    { exp:lex.INT_LITERAL   ,type:'number'      ,if:-2          ,spaced:true    ,goto:100 },

        /* 17 */    { exp:lex.op_cls_int    ,type:'op'          ,opt:true },
        /* 18 */    { exp:lex.clsref        ,type:'classname2'  ,if:-1 },
        /* 19 */    { exp:lex.NAT_LITERAL   ,type:'number'      ,if:-2          ,spaced:true    ,goto:100 },

        /* 20 */    { exp:lex.op_fmim       ,type:'op'          ,opt:true },
        /* 21 */    { exp:lex.CPREF         ,type:'atom'        ,opt:true       ,if:-1          ,spaced:true    ,goto:100 },
        /* 22 */    { exp:lex.fmim_tag      ,type:'keyword'     ,if:-2          ,spaced:true },
        /* 23 */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,spaced:true },
        /* 24 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-2          ,spaced:true    ,goto:100 },
        /* 25 */    { exp:lex.ident         ,type:'fieldname'   ,if:-3          ,spaced:true },
        /* 26 */    { exp:lex.utfref        ,type:'fieldtype'   ,if:-4          ,spaced:true    ,goto:100 },

        /* 27 */    { exp:lex.tableswitch   ,type:'op'          ,opt:true       ,pushctx:'tableswitch' },
        /* 28 */    { exp:lex.INT_LITERAL   ,type:'number'      ,if:-1          ,spaced:true    ,goto:100 },

        /* 36 */    { exp:lex.op_ldc        ,type:'op'          ,opt:true },
        /* 37 */    { exp:lex.CPREF         ,type:'atom'        ,opt:true       ,if:-1          ,goto:100       ,spaced:true },
        /* 38 */    { exp:lex.FLOAT_LITERAL ,type:'number'      ,opt:true       ,if:-2          ,goto:100       ,spaced:true  },
        /* 39 */    { exp:lex.LONG_LITERAL  ,type:'number'      ,opt:true       ,if:-3          ,goto:100       ,spaced:true  },
        /* 40 */    { exp:lex.INT_LITERAL   ,type:'number'      ,opt:true       ,if:-4          ,goto:100       ,spaced:true  },
        /* 41 */    { exp:lex.STR_LITERAL   ,type:'string'      ,opt:true       ,if:-5          ,goto:100       ,spaced:true  },
        /* 42 */    { exp:lex.class         ,type:'keyword'     ,opt:true       ,if:-6          ,spaced:true  },
        /* 43 */    { exp:lex.utfref        ,type:'classname2'  ,if:-1          ,goto:100       ,spaced:true  },
        /* 44 */    { exp:lex.methodtype    ,type:'keyword'     ,opt:true       ,if:-8          ,spaced:true  },
        /* 45 */    { exp:lex.utfref        ,type:'fieldname'   ,if:-1          ,goto:100       ,spaced:true },
        /* 46 */    { exp:lex.methodhandle  ,type:'keyword'     ,if:-10         ,spaced:true },
        /* 47 */    { exp:lex.handlecode    ,type:'keyword'     ,if:-1          ,spaced:true },
        /* 48 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-2          ,goto:100        ,spaced:true },
        /* 49 */    { exp:lex.fmim_tag      ,type:'keyword'     ,if:-3          ,spaced:true },
        /* 50 */    { exp:lex.clsref        ,type:'classname2'  ,if:-4          ,spaced:true },
        /* 51 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-5          ,goto:100        ,spaced:true },
        /* 52 */    { exp:lex.ident         ,type:'fieldname'   ,if:-6          ,spaced:true },
        /* 53 */    { exp:lex.utfref        ,type:'fieldtype'   ,if:-7          ,goto:100       ,spaced:true },

        /* 54 */    { exp:lex.lookupswitch  ,type:'op'          ,opt:true       ,goto:100       ,pushctx:'lookupswitch' },

        /* 55 */    { exp:lex.wide          ,type:'op'          ,opt:true },
        /* 56 */    { exp:lex.op_short      ,type:'op'          ,opt:true       ,if:-1 },
        /* 57 */    { exp:lex.NAT_LITERAL   ,type:'number'      ,if:-1          ,spaced:true    ,goto:100 },
        /* 58 */    { exp:lex.op_iinc       ,type:'op'          ,if:-3},
        /* 59 */    { exp:lex.NAT_LITERAL   ,type:'number'      ,if:-1          ,spaced:true },
        /* 60 */    { exp:lex.INT_LITERAL   ,type:'number'      ,if:-2          ,spaced:true    ,goto:100 },

        /* 61 */    { exp:lex.op_invint     ,type:'op'          ,opt:true },
        /* 62 */    { exp:lex.CPREF         ,type:'atom'        ,opt:true       ,if:-1          ,spaced:true    ,goto:6 },
        /* 63 */    { exp:lex.fmim_tag      ,type:'keyword'     ,if:-2          ,spaced:true },
        /* 64 */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,spaced:true },
        /* 65 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-2          ,spaced:true    ,goto:3 },
        /* 66 */    { exp:lex.ident         ,type:'fieldname'   ,if:-3          ,spaced:true },
        /* 67 */    { exp:lex.utfref        ,type:'fieldtype'   ,if:-4          ,spaced:true    ,goto:1 },
        /* 68 */    { exp:lex.NAT_LITERAL   ,type:'number'      ,if:-7          ,spaced:true    ,goto:100 },

                ]
            },

            {
                id:'LOOKUPSWITCH_ENTRY', chkctx:'lookupswitch', tokens:[
        /* 0  */    { exp:lex.NAT_LITERAL   ,type:'directive' },
        /* 1  */    { exp:lex.colon         ,type:'keyword'     ,spaced:true },
        /* 2  */    { exp:lex.label         ,type:'atom'        ,spaced:true },

                ]
            },
            {
                id:'LOOKUPSWITCH_DEFAULT_ENTRY', chkctx:'lookupswitch', tokens:[
        /* 0  */    { exp:lex.default       ,type:'keyword'     ,popctx:'lookupswitch'},
        /* 1  */    { exp:lex.colon         ,type:'operator' },
        /* 2  */    { exp:lex.label         ,type:'atom'        ,spaced:true },
                ]
            },

            {
                id:'TABLESWITCH_ENTRY', chkctx:'tableswitch', tokens:[
        /* 0  */    { exp:lex.label         ,type:'atom' },
                ]
            },
            {
                id:'TABLESWITCH_DEFAULT_ENTRY', chkctx:'tableswitch', tokens:[
        /* 0  */    { exp:lex.default       ,type:'keyword'     ,popctx:'tableswitch'},
        /* 1  */    { exp:lex.colon         ,type:'operator' },
        /* 2  */    { exp:lex.label         ,type:'atom'        ,spaced:true },
                ]
            },

            {
                id:'ATTRIBUTE', tokens:[
                    { exp:/.attribute\b/    ,type:'directive'       ,opt:true },
                    { exp:lex.utfref        ,type:'atom'            ,if:-1          ,spaced:true },
                    { exp:/length\b/        ,type:'keyword'         ,if:-2          ,opt:true       ,spaced:true },
                    { exp:lex.NAT_LITERAL   ,type:'atom'            ,if:-1          ,spaced:true },

                    { exp:lex.STR_LITERAL   ,type:'string'          ,if:-4          ,opt:true       ,spaced:true        ,goto:200 },

                    { exp:lex._lntable      ,type:'directive'       ,opt:true       ,pushctx:'linenumbertable'          ,goto:200 },

                    { exp:lex._lvartable    ,type:'directive'       ,opt:true       ,pushctx:'localvariabletable'       ,goto:200 },

                    { exp:lex._lvarttable   ,type:'directive'       ,opt:true       ,pushctx:'localvariabletypetable'   ,goto:200 },

                    { exp:lex._code         ,type:'directive'       ,opt:true },
                    { exp:lex.stack         ,type:'directive'       ,if:-1 },
                    { exp:lex.NAT_LITERAL   ,type:'number'          ,if:-2 },
                    { exp:lex.locals        ,type:'directive'       ,if:-3 },
                    { exp:lex.NAT_LITERAL   ,type:'number'          ,if:-4          ,goto:200 },

                    { exp:lex._stackmaptable,type:'directive'       ,opt:true       ,goto:200 },

                    { exp:lex._sourcefile   ,type:'directive'       ,opt:true },
                    { exp:lex.CPREF         ,type:'string'          ,if:-1          ,opt:true       ,goto:200 },
                    { exp:lex.STR_LITERAL   ,type:'string'          ,if:-2          ,goto:200 },

                    { exp:lex._innerclasses ,type:'directive'       ,opt:true       ,pushctx:'innerclasses'             ,goto:200 },

                    { exp:lex._constantvalue,type:'directive'       ,opt:true },
                    { exp:lex.CPREF         ,type:'atom'            ,opt:true       ,if:-1          ,goto:200           ,spaced:true },
                    { exp:lex.FLOAT_LITERAL ,type:'number'          ,opt:true       ,if:-2          ,goto:200           ,spaced:true },
                    { exp:lex.LONG_LITERAL  ,type:'number'          ,opt:true       ,if:-3          ,goto:200           ,spaced:true },
                    { exp:lex.INT_LITERAL   ,type:'number'          ,opt:true       ,if:-4          ,goto:200           ,spaced:true },
                    { exp:lex.STR_LITERAL   ,type:'string'          ,opt:true       ,if:-5          ,goto:200           ,spaced:true },
                    { exp:lex.class         ,type:'keyword'         ,opt:true       ,if:-6          ,spaced:true },
                    { exp:lex.utfref        ,type:'classname2'      ,if:-1          ,goto:200       ,spaced:true },
                    { exp:lex.methodtype    ,type:'keyword'         ,opt:true       ,if:-8          ,spaced:true },
                    { exp:lex.utfref        ,type:'fieldname'       ,if:-1          ,goto:200       ,spaced:true },
                    { exp:lex.methodhandle  ,type:'keyword'         ,if:-10         ,spaced:true },
                    { exp:lex.handlecode    ,type:'keyword'         ,if:-1          ,spaced:true },
                    { exp:lex.CPREF         ,type:'fieldname'       ,opt:true       ,if:-2          ,goto:200           ,spaced:true },
                    { exp:lex.fmim_tag      ,type:'keyword'         ,if:-3          ,spaced:true },
                    { exp:lex.clsref        ,type:'classname2'      ,if:-4          ,spaced:true },
                    { exp:lex.CPREF         ,type:'fieldname'       ,opt:true       ,if:-5          ,goto:200           ,spaced:true },
                    { exp:lex.ident         ,type:'fieldname'       ,if:-6          ,spaced:true },
                    { exp:lex.utfref        ,type:'fieldtype'       ,if:-7          ,spaced:true    ,goto:200 },

                    { exp:lex._enclosing    ,type:'directive'       ,opt:true },
                    { exp:lex.method        ,type:'directive'       ,if:-1          ,spaced:true },
                    { exp:lex.clsref        ,type:'classname2'      ,if:-2          ,spaced:true },
                    { exp:lex.CPREF         ,type:'fieldname'       ,if:-3          ,opt:true       ,goto:200           ,spaced:true },
                    { exp:lex.ident         ,type:'fieldname'       ,if:-4          ,spaced:true },
                    { exp:lex.utfref        ,type:'fieldtype'       ,if:-5          ,spaced:true    ,goto:200 },

                    { exp:lex._signature    ,type:'directive'       ,opt:true },
                    { exp:lex.utfref        ,type:'fieldtype'       ,if:-1          ,spaced:true    ,goto:200 },

                    { exp:lex._runtime      ,type:'directive'       ,opt:true       ,pushctx:'runtime'},
                    { exp:lex.visibility    ,type:'directive'       ,if:-1          ,spaced:true },
                    { exp:lex.annotations   ,type:'directive'       ,if:-2          ,spaced:true    ,goto:200 },

                    { exp:lex._synthetic    ,type:'directive'       ,opt:true       ,goto:200 },

                    { exp:lex._srcdebugext  ,type:'directive'       ,opt:true },
                    { exp:lex.STR_LITERAL   ,type:'string'          ,if:-1          ,goto:200       ,spaced:true },

                    { exp:lex._methodparams ,type:'directive'       ,opt:true       ,pushctx:'methodparameters'         ,goto:200 },

                    { exp:lex._bsmethods    ,type:'directive'       ,opt:true       ,goto:200 },

                    { exp:lex._deprecated   ,type:'directive'       ,opt:true       ,goto:200 },

                    { exp:lex._annotationdef,type:'directive'       ,opt:true },
                    { exp:lex.prim_tag      ,type:'keyword'         ,opt:true       ,if:-1          ,spaced:true },
                    { exp:lex.CPREF         ,type:'atom'            ,opt:true       ,if:-1          ,goto:200           ,spaced:true },
                    { exp:lex.FLOAT_LITERAL ,type:'number'          ,opt:true       ,if:-2          ,goto:200           ,spaced:true },
                    { exp:lex.LONG_LITERAL  ,type:'number'          ,opt:true       ,if:-3          ,goto:200           ,spaced:true },
                    { exp:lex.INT_LITERAL   ,type:'number'          ,opt:true       ,if:-4          ,goto:200           ,spaced:true },
                    { exp:lex.STR_LITERAL   ,type:'string'          ,opt:true       ,if:-5          ,goto:200           ,spaced:true },
                    { exp:lex.class         ,type:'keyword'         ,opt:true       ,if:-6          ,spaced:true },
                    { exp:lex.utfref        ,type:'classname2'      ,if:-1          ,goto:200       ,spaced:true },
                    { exp:lex.methodtype    ,type:'keyword'         ,opt:true       ,if:-8          ,spaced:true },
                    { exp:lex.utfref        ,type:'fieldname'       ,if:-1          ,goto:200       ,spaced:true },
                    { exp:lex.methodhandle  ,type:'keyword'         ,if:-10         ,spaced:true },
                    { exp:lex.handlecode    ,type:'keyword'         ,if:-1          ,spaced:true },
                    { exp:lex.CPREF         ,type:'fieldname'       ,opt:true       ,if:-2          ,goto:200           ,spaced:true },
                    { exp:lex.fmim_tag      ,type:'keyword'         ,if:-3          ,spaced:true },
                    { exp:lex.clsref        ,type:'classname2'      ,if:-4          ,spaced:true },
                    { exp:lex.CPREF         ,type:'fieldname'       ,opt:true       ,if:-5          ,goto:200           ,spaced:true },
                    { exp:lex.ident         ,type:'fieldname'       ,if:-6          ,spaced:true },
                    { exp:lex.utfref        ,type:'fieldtype'       ,if:-7          ,spaced:true    ,goto:200 },
                    { exp:/string\b/        ,type:'keyword'         ,opt:true       ,if:-19         ,spaced:true },
                    { exp:lex.utfref        ,type:'string'          ,if:-1          ,goto:200       ,spaced:true },
                    { exp:/class\b/         ,type:'keyword'         ,opt:true       ,if:-21         ,spaced:true },
                    { exp:lex.utfref        ,type:'classname2'      ,if:-1          ,goto:200       ,spaced:true },
                    { exp:/enum\b/          ,type:'keyword'         ,opt:true       ,if:-23         ,spaced:true },
                    { exp:lex.utfref        ,type:'fieldname'       ,if:-1          ,spaced:true },
                    { exp:lex.utfref        ,type:'fieldtype'       ,if:-2          ,goto:200       ,spaced:true },
                    { exp:/array\b/         ,type:'keyword'         ,opt:true       ,if:-26         ,goto:200    ,spaced:true ,pushctx:'array'},
                    { exp:/annotation\b/    ,type:'keyword'         ,if:-27         ,goto:200       ,spaced:true ,pushctx:'annotation'},

                    { exp:lex._exceptions   ,type:'directive' },
                    { exp:lex.clsref        ,type:'classname2'      ,opt:true       ,if:-1          ,goto:0             ,final:true },


                ]
            },

            {
                id:'CONST', tokens:[
        /* 0  */    { exp:lex._const        ,type:'directive' },
        /* 1  */    { exp:lex.CPREF         ,type:'atom' },
        /* 2  */    { exp:lex.eq            ,type:'operator' },


        /* 3  */    { exp:lex.CPREF         ,type:'atom'        ,opt:true       ,goto:100 },

        /* 4  */    { exp:lex.class         ,type:'keyword'     ,opt:true },
        /* 5  */    { exp:lex.utfref        ,type:'classname2'  ,if:-1          ,goto:100       ,spaced:true },
        /* 6  */    { exp:lex.methodtype    ,type:'keyword'     ,opt:true },
        /* 7  */    { exp:lex.utfref        ,type:'fieldname'   ,if:-1          ,goto:100       ,spaced:true },
        /* 8  */    { exp:lex.methodhandle  ,type:'keyword'     ,opt:true },
        /* 9  */    { exp:lex.handlecode    ,type:'keyword'     ,if:-1          ,spaced:true },
        /* 10 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-2          ,goto:100   ,spaced:true },
        /* 11 */    { exp:lex.fmim_tag      ,type:'keyword'     ,if:-3          ,spaced:true },
        /* 12 */    { exp:lex.clsref        ,type:'classname2'  ,if:-4          ,spaced:true },
        /* 13 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-5          ,goto:100   ,spaced:true },
        /* 14 */    { exp:lex.ident         ,type:'fieldname'   ,if:-6          ,spaced:true },
        /* 15 */    { exp:lex.utfref        ,type:'fieldtype'   ,if:-7          ,spaced:true    ,goto:100 },

        /* 16 */    { exp:lex.i_tag         ,type:'keyword'     ,opt:true },
        /* 17 */    { exp:lex.INT_LITERAL   ,type:'number'      ,if:-1          ,goto:100       ,spaced:true },
        /* 18 */    { exp:lex.l_tag         ,type:'keyword'     ,opt:true },
        /* 19 */    { exp:lex.LONG_LITERAL  ,type:'number'      ,if:-1          ,goto:100       ,spaced:true },
        /* 20 */    { exp:lex.f_tag         ,type:'keyword'     ,opt:true },
        /* 21 */    { exp:lex.FLOAT_LITERAL ,type:'number'      ,if:-1          ,goto:100       ,spaced:true },
        /* 22 */    { exp:lex.d_tag         ,type:'keyword'     ,opt:true },
        /* 23 */    { exp:lex.DOUBLE_LITERAL,type:'number'      ,if:-1          ,goto:100       ,spaced:true },
        /* 24 */    { exp:lex.s_tag         ,type:'keyword'     ,opt:true },
        /* 25 */    { exp:lex.CPREF         ,type:'string'      ,if:-1          ,opt:true       ,goto:100       ,spaced:true },
        /* 26 */    { exp:lex.STR_LITERAL   ,type:'string'      ,if:-2          ,goto:100       ,spaced:true },


        /* 27 */    { exp:lex.utf8          ,type:'keyword'     ,opt:true },
        /* 28 */    { exp:lex.ident         ,type:'string'      ,if:-1          ,goto:100       ,spaced:true },
        /* 29 */    { exp:lex.nameandtype   ,type:'keyword'     ,opt:true },
        /* 30 */    { exp:lex.utfref        ,type:'fieldname'   ,if:-1          ,spaced:true },
        /* 31 */    { exp:lex.utfref        ,type:'fieldtype'   ,if:-2          ,goto:100       ,spaced:true },

        /* 32 */    { exp:lex.fmim_tag      ,type:'keyword'     ,opt:true       ,spaced:true },
        /* 33 */    { exp:lex.clsref        ,type:'classname2'  ,if:-1          ,spaced:true },
        /* 34 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-2          ,spaced:true    ,goto:100 },
        /* 35 */    { exp:lex.ident         ,type:'fieldname'   ,if:-3          ,spaced:true },
        /* 36 */    { exp:lex.utfref        ,type:'fieldtype'   ,if:-4          ,spaced:true    ,goto:100 },

        /* 37 */    { exp:lex.invdyn_tag    ,type:'keyword'     ,spaced:true },
        /* 38 */    { exp:lex.BSREF         ,type:'atom'        ,if:-1          ,spaced:true },
        /* 39 */    { exp:lex.CPREF         ,type:'fieldname'   ,opt:true       ,if:-2          ,spaced:true    ,goto:100 },
        /* 40 */    { exp:lex.ident         ,type:'fieldname'   ,if:-3          ,spaced:true },
        /* 41 */    { exp:lex.utfref        ,type:'fieldtype'   ,if:-4          ,spaced:true    ,goto:100 },

                ]
            },

            {
                id:'CATCH', tokens:[
        /* 0  */    { exp:lex._catch        ,type:'directive' },
        /* 1  */    { exp:lex.clsref        ,type:'classname2'      ,spaced:true },
        /* 2  */    { exp:lex.from          ,type:'keyword'         ,spaced:true },
        /* 3  */    { exp:lex.label         ,type:'atom'            ,spaced:true },
        /* 4  */    { exp:lex.to            ,type:'keyword'         ,spaced:true },
        /* 5  */    { exp:lex.label         ,type:'atom'            ,spaced:true },
        /* 6  */    { exp:lex.using         ,type:'keyword'         ,spaced:true },
        /* 7  */    { exp:lex.label         ,type:'atom'            ,spaced:true },
                ]
            },

        ];

        let asmLineErrors = [];
        let lineErrors = [];
        let lineErrorTimer = [];
        let annotateScrollbarErrorsTimer;
        let errorAnnotation;

        function updateScrollbarErrorAnnotation() {
            clearTimeout(annotateScrollbarErrorsTimer);
            annotateScrollbarErrorsTimer = setTimeout(()=>{
                let annotations = [];
                if (lineErrors) {
                    for (let n = 0; n < lineErrors.length; ++n) {
                        if (lineErrors[n] && lineErrors[n].length > 0) {
                            annotations.push({
                                from:{line:n},
                                to:{line: n+1 }
                            });
                        }
                    }
                }
                errorAnnotation.update(annotations);
            },1000);
        }

        function addError(line,msg) {
            if (!lineErrors[line]) {
                if (debug) console.log('create errorarray line' + line);
                lineErrors[line] = [];
            }
            lineErrors[line].push(msg);
            if (debug) console.log('error for line ' + line);
            if (debug) console.log(lineErrors[line]);
        }

        function clearErrors(line) {
            if (lineErrors[line]) lineErrors[line].length = 0;
            else lineErrors[line] = [];
        }

        function addErrorGutter(line) {
            if (debug) console.log('adding error gutter for line ' + line);
            let msg;
            let maxWidth = 0;
            let msgs = [];
            if (!lineErrors[line]) lineErrors[line] = [];
            let includeNumbers = (lineErrors[line].length + (asmLineErrors[line]? 1:0)) > 1;
            for (let n=0; n<lineErrors[line].length; ++n) {
                msgs.push((includeNumbers? ('['+(n+1)+']: '):'') + lineErrors[line][n]);
                maxWidth = Math.max(maxWidth,msgs[n].length);
            }
            if (asmLineErrors[line]) {
                const html = asmLineErrors[line];
                msgs.push(((msgs.length > 0)? ('[' + (msgs.length+1) + ']: '):'') + html);
                // asmlines.forEach((l)=> {
                html.split('\n').forEach((l)=> {
                    maxWidth = Math.max(maxWidth,l.length);
                });
            }
            if (debug) console.log(msgs);

            if (msgs.length > 0) msg = msgs.join('<br>');
            else return;

            let el = document.createElement('div');
            let el2 = document.createElement('div');
            el.className = 'fa fa-exclamation-circle gutter-error';
            el2.className = 'tooltip';
            el2.innerHTML = msg;
            if (maxWidth > 100) {
                el2.style.minWidth = '800px';
                el2.style.whiteSpace = 'normal';
            }
            el.onmouseover = function() {
                el.appendChild(el2);
                el2.style.top = '20px';
                let rect = el2.getBoundingClientRect();
                if ((window.innerHeight - 50 - rect.bottom) < 0) {
                    el2.style.top = -rect.height +'px'
                }
            };
            el.onmouseout = function() { el.removeChild(el2); };
            setTimeout(() => { editor.setGutterMarker(line, 'gut-info',el); },1);
            updateScrollbarErrorAnnotation();
        }

        function removeErrorGutter(line) {
            setTimeout(() =>{
                if (!asmLineErrors[line]) editor.removeLineClass(line, 'background');
                editor.setGutterMarker(line, 'gut-info', null);
            }, 1);
            updateScrollbarErrorAnnotation();
        }

        function isLastToken (stream) {
            if (stream.eol()) return true;
            return !stream.match(/\s+\S|\S+/,false);
        }

        function canTerminate (state,rule) {
            for (let i = state.step; i < rule.tokens.length; ++i) {
                if (!(rule.tokens[i].opt || (rule.tokens[i].if!==undefined && !state.matched[i+rule.tokens[i].if]))) return false;
            }
            return true;
        }

        function terminateLine (state) {
            let line = state.line;
            if (debug) console.log('terminating line:' + line);
            clearTimeout(lineErrorTimer[line]);
            lineErrorTimer[line] = setTimeout(() => { addErrorGutter(line); },500);
            state.parse = undefined;
            state.spaced = false;
            state.matched.length = 0;
            state.line = 0;
        }

        function initialParse(){
            let context = CodeMirror.volcano.getContextBefore(editor,0,true);
            for (let n = 0; n < editor.lineCount(); ++n) {
                CodeMirror.volcano.processLine(editor,editor.getLine(n),context);
                context.nextLine();
            }
        }

        return {

            init: function(){
                if (!errorAnnotation) errorAnnotation = editor.annotateScrollbar({className:'scrollbar-error-annotation'});
                lineErrors.length = 0;
                editor.clearGutter('gut-info');
                initialParse();
                updateScrollbarErrorAnnotation();
            },

            removeErrorGutterFromLine: function(line){
                clearErrors(line);
                removeErrorGutter(line);
            },

            addAssemblerError: function(line,message) {
                asmLineErrors[line] = message;
                addErrorGutter(line);
                editor.addLineClass(line, 'background', 'error');
            },

            clearAsmErrors: function() {
                asmLineErrors.length = 0;
            },

            startState: function() {
                return {
                    line: 0,
                    parse: undefined,
                    step:0,
                    spaced: false,
                    matched: [],
                    context:[]
                };
            },

            token: function(stream, state) {

                if (stream.eatSpace()) {
                    if (debug) console.log('eatspace[' + stream.string + ']->[' + stream.current() + ']');
                    state.spaced = true;
                    return null;
                }

                if (state.parse === undefined) {
                    state.line = stream.lineOracle.line;
                    if (state.line > 0) {
                        if (editor.getLine(state.line-1).length === 0) {
                            clearErrors(state.line-1);
                            removeErrorGutter(state.line-1);
                        }
                    }
                    if (debug) console.log('################### START RULE TEST LINE ' + state.line);
                    for (let n in rules) {
                        let rule = rules[n];
                        if (rule.chkctx &&
                            (state.context.length===0 || state.context[state.context.length-1]!==rule.chkctx)
                        ) continue;

                        if (debug) console.log('################### RULE TEST -> ' + rule.id);
                        for (let i = 0; i < rule.tokens.length; ++i){
                            let token = rule.tokens[i];
                            if (token.if===undefined) {
                                if (debug) console.log('check token [' + token.exp + ']->' + token.opt);
                                if (stream.match(token.exp, false)) {
                                    if (debug) console.log('################### RULE START -> ' + rule.id);
                                    state.parse = rule;
                                    state.step = 0;
                                    clearErrors(state.line);
                                    removeErrorGutter(state.line);
                                    return null;
                                }
                                else if (!token.opt) break;
                            }
                        }
                    }
                    clearErrors(state.line);
                    removeErrorGutter(state.line);
                    addError(state.line,'Unrecognized sentence');
                    stream.skipToEnd();
                    terminateLine(state);
                    return null;
                }
                else {
                    let rule = state.parse;
                    while (true) {
                        let token = rule.tokens[state.step];
                        while (token && token.if!==undefined && !state.matched[state.step+token.if]) {
                            ++state.step;
                            token = rule.tokens[state.step];
                        }
                        if (debug) console.log('======> RULE STEP ' + state.parse.id + '->' + state.step);
                        if (debug) console.log(stream);
                        if (debug) console.log(stream.string);
                        if (!token) break;
                        let m = stream.match(token.exp);
                        let spacedCond = (token.spaced === undefined) || (token.spaced === state.spaced);
                        if (m && spacedCond) {
                            if (token.pushctx) state.context.push(token.pushctx);
                            else if (token.popctx) {
                                if ((state.context.length > 0) &&
                                    (state.context[state.context.length-1] === token.popctx)
                                )  state.context.pop();
                                else addError(state.line,'Sentence out of context `' + token.popctx + '`');
                            }
                            state.matched[state.step] = true;
                            if (debug) console.log('TOKENMATCH [' + token.exp + ']->[' + m[0] + ']');
                            state.spaced = false;
                            if(token.goto!==undefined) {
                                if (token.goto < 0)
                                    for (let n = -1; n >= token.goto; --n) state.matched[state.step + n] = undefined;
                                state.step += token.goto;
                            }
                            else ++state.step;
                            if (isLastToken(stream)) {
                                if (!canTerminate(state,rule)) {
                                    if (debug) console.log('Error by no end of sentence');
                                    addError(state.line,'Unterminated statement');
                                    terminateLine(state);
                                    return token.type;
                                }
                                terminateLine(state);
                            }
                            return token.type;
                        }
                        else if (m){
                            if (token.pushctx) state.context.push(token.pushctx);
                            else if (token.popctx) {
                                if ((state.context.length > 0) &&
                                    (state.context[state.context.length-1] === token.popctx)
                                )  state.context.pop();
                                else addError(state.line,'Sentence out of context `' + token.popctx + '`');
                            }
                            state.matched[state.step] = true;
                            if (debug) console.log('TOKENMATCHSPACEERROR [' + token.exp + ']->[' + m[0] + ']');
                            state.spaced = false;
                            if(token.goto!==undefined) {
                                if (token.goto < 0)
                                    for (let n = -1; n >= token.goto; --n) state.matched[state.step + n] = undefined;
                                state.step += token.goto;
                            }
                            else ++state.step;
                            let last = isLastToken(stream);
                            if (last && !canTerminate(state,rule)) {
                                if (debug) console.log('Error by no end of sentence');
                                addError(state.line,'Unterminated statement');
                                terminateLine(state);
                                return token.type;
                            }
                            if (debug) console.log('Error by token spaced condition');
                            if (!state.spaced) addError(state.line,'Error token `' + stream.current() + '` is separated with whitespace');
                            else addError(state.line,'Token `' + stream.current() + '` is not separated with whitespace');
                            if (last) terminateLine(state);
                            return 'error';
                        }
                        else {
                            if (debug) console.log('NOMATCH [' + token.exp + ']');
                            if (token.opt) {
                                if (isLastToken(stream)) {
                                    terminateLine(state);
                                    return null;
                                }
                                else {
                                    if (token.final) state.step = rule.tokens.length;
                                    else ++state.step;
                                }
                            }
                            else {
                                if (stream.match(lex.comment)){
                                    let spaced = state.spaced;
                                    if (spaced) {
                                        if (debug) console.log('BUT COMMENT');
                                        if (debug) console.log('Error by no end of sentence');
                                        addError(state.line,'Unterminated statement');
                                        terminateLine(state);
                                        return 'comment';
                                    }
                                    else {
                                        if (debug) console.log('Error by no optional token with bad token');
                                        addError(state.line,'Comment is not separated with whitespace');
                                        terminateLine(state);
                                        return 'error';
                                    }
                                }
                                stream.match(/\S+/);
                                if (debug) console.log('Error by no optional token with bad token');
                                addError(state.line,'Unexpected token `' + stream.current() + '`');
                                if (isLastToken(stream)) terminateLine(state);
                                return 'error';
                            }
                        }
                    }

                    if (debug) console.log('NOTOKEN');
                    if (stream.match(lex.comment)){
                        let spaced = state.spaced;
                        if (spaced) {
                            if (debug) console.log('BUT COMMENT');
                            terminateLine(state);
                            return 'comment';
                        }
                        else {
                            if (debug) console.log('Error by no spaced comment');
                            addError(state.line,'Comment is not separated with whitespace');
                            terminateLine(state);
                            return 'error';
                        }
                    }
                    stream.match(/\S+/);
                    if (debug) console.log('Error by extra tokens token with bad token');
                    addError(state.line,'Unexpected token `' + stream.current() + '`');
                    if (isLastToken(stream)) terminateLine(state);
                    return 'error';

                }
            }
        };
    });

});

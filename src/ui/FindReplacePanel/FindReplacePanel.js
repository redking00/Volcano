function FindReplacePanel(codemirror) {

    let m_findPanel = null;
    let m_withReplace = false;
    let m_liveQueryFindTimeout = null;
    let m_liveInputFindTimeout = null;
    let m_cm = codemirror;
    let me = this;

    function panelKeyDown(evt) {
        if (evt.key === 'Escape') setTimeout(() => {
            me.close();
        }, 1);
    }

    function docChanged() {
        clearTimeout(m_liveInputFindTimeout);
        m_liveInputFindTimeout = setTimeout(() => {
            if (m_findPanel) {
                let query = m_findPanel.querySelector('#ftext').value;
                searchEngine.calcMatches(query);
                updateFindCountLabel();
            }
        }, 500);
    }

    function updateFindCountLabel() {
        if (m_findPanel) {
            let count = searchEngine.matchList.length;
            let zero = count === 0;
            m_findPanel.querySelector('#fcspn').innerText = (zero ? 'No' : count) + ' matches';
            m_findPanel.querySelector("#fnbut").disabled = count < 2;
            m_findPanel.querySelector("#fpbut").disabled = count < 2;
            if (m_withReplace) {
                m_findPanel.querySelector("#rrbut").disabled = zero;
                m_findPanel.querySelector("#rabut").disabled = count < 2;
                m_findPanel.querySelector("#rebut").disabled = count < 2;
            }
            let ftext = m_findPanel.querySelector('#ftext');
            if (zero) {
                ftext.classList.remove('match');
                ftext.classList.remove('nomatch');
                if (ftext.value.length > 0) ftext.classList.add('nomatch');
            }
            else {
                ftext.classList.remove('nomatch');
                ftext.classList.add('match');
            }
        }
    }

    this.close = function() {
        if (m_findPanel) {
            m_findPanel.remove();
            m_findPanel = null;
            searchEngine.clearSearch();
        }
        CodeMirror.off(window, 'keydown', panelKeyDown);
        m_cm.off('change', docChanged);
        m_cm.getWrapperElement().parentElement.style.top = '0px';
    };

    this.open = function (withReplace, findText) {

        function ftextKeyDown(){
            clearTimeout(m_liveQueryFindTimeout);
            m_liveQueryFindTimeout = setTimeout(() => {
                let query = ftext.value;
                let matchCase = fmcheck.checked;
                searchEngine.commands.find(query, matchCase);
                updateFindCountLabel(query);
            }, 250);
        }

        if (m_findPanel && withReplace === m_withReplace) return;
        else if (m_findPanel){
            let ftext = m_findPanel.querySelector("#ftext");
            let lastFind = ftext.value;
            this.close();
            setTimeout(()=>{this.open(withReplace,lastFind);},200);
            return;
        }
        m_withReplace = withReplace;
        let node = document.createElement("div");
        node.className = "FindReplace-panel";
        let content =
            '<input id="ftext" type="text" placeholder = "Use /re/ for regexp">' +
            '<button id="fpbut" class="fa fa-arrow-up" title="Previous"disabled></button>' +
            '<button id="fnbut" class="fa fa-arrow-down" title="Next" disabled></button>' +
            '<div class="toggleButton">' +
                '<div>Match case</div>' +
                '<input id="fmcheck" type="checkbox" checked/>' +
                '<label for="fmcheck"></label>' +
            '</div>' +
            '<span id="fcspn"></span>';

        if (withReplace) {
            content+=
            '<br>'+
            '<input  id="rtext" type="text" placeholder = "Replace with">' +
            '<button id="rrbut" class="repbut" disabled>Replace</button>' +
            '<button id="rabut" class="repbut" disabled>Replace all</button>' +
            '<button id="rebut" class="repbut" disabled>Exclude</button>';
        }

        content+= '<a id ="fcbut" title="close">✖</a>';
        node.innerHTML = content;

        let fcbut = node.querySelector("#fcbut");
        let ftext = node.querySelector("#ftext");
        let fnbut = node.querySelector("#fnbut");
        let fpbut = node.querySelector("#fpbut");
        let fmcheck = node.querySelector("#fmcheck");

        window.document.body.appendChild(node);
        m_findPanel = node;
        ftext.focus();

        m_cm.getWrapperElement().parentElement.style.top = node.getBoundingClientRect().height + 'px';

        m_cm.on('change', docChanged);

        CodeMirror.on(window, 'keydown', panelKeyDown);

        CodeMirror.on(fnbut, "click", function () {
            searchEngine.commands.findNext();
        });

        CodeMirror.on(fpbut, "click", function () {
            searchEngine.commands.findPrev();
        });

        CodeMirror.on(ftext, "keydown", ftextKeyDown);

        CodeMirror.on(fmcheck, "click", function () {
            let query = ftext.value;
            let matchCase = fmcheck.checked;
            searchEngine.commands.find(query, matchCase);
            updateFindCountLabel(query);
        });

        CodeMirror.on(fcbut, "click", () => {
            me.close();
        });

        if (findText) {
            ftext.value = findText;
            ftextKeyDown();
        }

        if (withReplace) {
            let rrbut = node.querySelector('#rrbut');
            let rabut = node.querySelector('#rabut');
            let rebut = node.querySelector('#rebut');

            CodeMirror.on(rrbut, "click", () => {
                let rtext = node.querySelector('#rtext');
                if (m_cm.somethingSelected())
                    m_cm.replaceSelection(rtext.value.toString());
                searchEngine.commands.findNext();
            });

            CodeMirror.on(rabut, "click", () => {
                let rtext = node.querySelector('#rtext');
                let selects = [];
                let reps = [];
                searchEngine.matchList.forEach((match)=>{
                    if (!match.excluded) {
                        selects.push({anchor: match.from, head: match.to});
                        reps.push(rtext.value.toString());
                    }
                });
                m_cm.setSelections(selects);
                m_cm.off('change', docChanged);
                m_cm.replaceSelections(reps);
                m_cm.on('change', docChanged);
                selects.length = 0;
                selects = null;
                reps.length = 0;
                reps = null;
                m_cm.getMode().init();
                docChanged();
            });

            CodeMirror.on(rebut, "click", () => {
                let selection = m_cm.listSelections()[0];
                for (let n = 0; n < searchEngine.matchList.length; ++n) {
                    if (selection.anchor.line === searchEngine.matchList[n].from.line
                        && selection.anchor.ch === searchEngine.matchList[n].from.ch) {
                        searchEngine.matchList[n].excluded = true;
                        break;
                    }
                }
                searchEngine.commands.findNext();
            });
        }

    };

    let searchEngine = {
        matchList: [],
        matchCase: false,

        SearchState: function () {
            return {
                posFrom: null,
                posTo: null,
                lastQuery: null,
                query: null,
                overlay: null
            };
        },

        getSearchState: function () {
            return m_cm.state.search || (m_cm.state.search = searchEngine.SearchState());
        },

        parseString: function (string) {
            return string.replace(/\\(.)/g, function (_, ch) {
                if (ch === "n") return "\n"
                if (ch === "r") return "\r"
                return ch
            })
        },

        parseQuery: function (query) {
            let isRE = query.match(/^\/(.*)\/([a-z]*)$/);
            if (isRE) {
                try {
                    query = new RegExp(isRE[1], isRE[2].indexOf("i") === -1 ? "" : "i");
                }
                catch (e) {
                } // Not a regular expression after all, do a string search
            } else {
                query = searchEngine.parseString(query)
            }
            if (typeof query === "string" ? query === "" : query.test(""))
                query = /x^/;
            return query;
        },

        searchOverlay: function (query, caseInsensitive) {
            if (typeof query === "string")
                query = new RegExp(query.replace(/[\-\[\]\/{}()*+?.\\^$|]/g, "\\$&"), caseInsensitive ? "gi" : "g");
            else if (!query.global)
                query = new RegExp(query.source, query.ignoreCase ? "gi" : "g");
            return {
                token: function (stream) {
                    query.lastIndex = stream.pos;
                    let match = query.exec(stream.string);
                    if (match && match.index === stream.pos) {
                        stream.pos += match[0].length || 1;
                        return "searching";
                    } else if (match) {
                        stream.pos = match.index;
                    } else {
                        stream.skipToEnd();
                    }
                }
            };
        },

        getSearchCursor: function (query, pos) {
            return m_cm.getSearchCursor(query, pos, {caseFold: !searchEngine.matchCase, multiline: true});
        },

        startSearch: function (state, query) {
            state.queryText = query;
            state.query = searchEngine.parseQuery(query);
            m_cm.removeOverlay(state.overlay, !searchEngine.matchCase);
            state.overlay = searchEngine.searchOverlay(state.query, !searchEngine.matchCase);
            m_cm.addOverlay(state.overlay);
            if (m_cm.showMatchesOnScrollbar) {
                if (state.annotate) {
                    state.annotate.clear();
                    state.annotate = null;
                }
                state.annotate = m_cm.showMatchesOnScrollbar(state.query, !searchEngine.matchCase);
            }
        },

        clearSearch: function () {
            searchEngine.matchList.length = 0;
            m_cm.operation(function () {
                let state = searchEngine.getSearchState();
                state.lastQuery = state.query;
                if (!state.query) return;
                state.query = state.queryText = null;
                m_cm.removeOverlay(state.overlay);
                if (state.annotate) {
                    state.annotate.clear();
                    state.annotate = null;
                }
            });
            m_cm.state.search = null;
        },

        findNext: function (rev, callback) {
            m_cm.operation(function () {
                let state = searchEngine.getSearchState();
                let cursor = searchEngine.getSearchCursor(state.query, rev ? state.posFrom : state.posTo);
                if (!cursor.find(rev)) {
                    cursor = searchEngine.getSearchCursor(state.query, rev ? CodeMirror.Pos(m_cm.lastLine()) : CodeMirror.Pos(m_cm.firstLine(), 0));
                    if (!cursor.find(rev)) return;
                }
                m_cm.setSelection(cursor.from(), cursor.to());
                m_cm.scrollIntoView({from: cursor.from(), to: cursor.to()}, 20);
                state.posFrom = cursor.from();
                state.posTo = cursor.to();
                if (callback) callback(cursor.from(), cursor.to())
            });
        },

        calcMatches: function () {
            searchEngine.matchList.length = 0;
            if (m_cm.state.search) {
                let query = m_cm.state.search.query;
                if (query) {
                    let match;
                    let sc = searchEngine.getSearchCursor(query);
                    let line = 0;
                    let ch = 0;
                    while (true) {
                        match = sc.matches(false, {line: line, ch: ch});
                        if (match) {
                            line = match.to.line;
                            ch = match.to.ch;
                            searchEngine.matchList.push(match);
                        }
                        else break;
                    }
                }
            }
        },

        commands: {
            find: function (query, matchCase) {
                searchEngine.matchCase = matchCase;
                searchEngine.clearSearch();
                searchEngine.startSearch(searchEngine.getSearchState(), query);
                searchEngine.calcMatches();
                if(!searchEngine.getSearchState().posFrom) searchEngine.commands.findNext();
            },

            findNext: function () {
                searchEngine.findNext(false);
            },

            findPrev: function () {
                searchEngine.findNext(true);
            }
        }
    }
}
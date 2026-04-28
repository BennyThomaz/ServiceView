/* DiagramManager — wraps mxGraph instances, one per tab */
(function (global) {
    'use strict';

    let stencilsLoaded = false;

    async function loadStencils() {
        if (stencilsLoaded) return;
        try {
            const resp = await fetch('/stencils/flowchart.xml');
            const xmlText = await resp.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
            const children = xmlDoc.documentElement.childNodes;
            for (let i = 0; i < children.length; i++) {
                const shape = children[i];
                if (shape.nodeType === mxConstants.NODETYPE_ELEMENT) {
                    mxStencilRegistry.addStencil(shape.getAttribute('name'), new mxStencil(shape));
                }
            }
            stencilsLoaded = true;
        } catch (e) {
            console.warn('Stencil load warning:', e);
        }
    }

    class DiagramManager {
        constructor() {
            this._instances = {};  // tabId -> { graph, container }
        }

        async render(containerId, graphXML) {
            // Configure mxGraph constants (once)
            mxConstants.SHADOWCOLOR = '#C0C0C0';
            mxConstants.SHADOW_OPACITY = 0.5;
            mxConstants.SHADOW_OFFSET_X = 4;
            mxConstants.SHADOW_OFFSET_Y = 4;
            mxConstants.HANDLE_FILLCOLOR = '#99ccff';
            mxConstants.HANDLE_STROKECOLOR = '#0088cf';
            mxConstants.VERTEX_SELECTION_COLOR = '#00a8ff';

            mxConnectionHandler.prototype.outlineConnect = true;
            mxEdgeHandler.prototype.manageLabelHandle = true;
            mxEdgeHandler.prototype.outlineConnect = true;
            mxCellHighlight.prototype.keepOnTop = true;

            await loadStencils();

            const container = document.getElementById(containerId);
            if (!container) throw new Error('Container not found: ' + containerId);

            // Destroy existing instance if re-rendering
            if (this._instances[containerId]) {
                this._instances[containerId].graph.destroy();
                delete this._instances[containerId];
            }

            mxEvent.disableContextMenu(container);
            const graph = new mxGraph(container);
            // When a cell value is an <object> XML element, return its label attribute
            // directly (including empty string). The default impl treats "" as falsy
            // and falls back to the node name ("object"), producing a visible label.
            graph.convertValueToString = function(cell) {
                const v = cell.value;
                if (v != null && v.nodeType === 1 && v.hasAttribute('label')) {
                    return v.getAttribute('label');
                }
                return mxGraph.prototype.convertValueToString.apply(this, arguments);
            };
            graph.setCellsEditable(false);
            graph.setConnectable(false);
            graph.foldingEnabled = true;
            graph.isCellFoldable = function (cell) {
                if (this.model.isEdge(cell)) return false;
                return cell.parent === this.getDefaultParent();
            };

            // Only direct children of the default parent (service containers,
            // external HTTP containers, DB cylinders) are movable/deletable.
            // Edges, source nodes, destination nodes, and icon cells are locked.
            const _defaultMovable = graph.isCellMovable.bind(graph);
            graph.isCellMovable = function(cell) {
                if (this.model.isEdge(cell)) return false;
                if (cell.parent && cell.parent !== this.getDefaultParent()) return false;
                return _defaultMovable(cell);
            };
            graph.isCellDeletable = function(cell) {
                if (this.model.isEdge(cell)) return false;
                if (cell.parent && cell.parent !== this.getDefaultParent()) return false;
                return this.cellsDeletable;
            };
            graph.isCellResizable = function() { return false; };

            // Visible fold icons for dark-background swimlane headers
            const mkFoldIcon = (points) => new mxImage(
                'data:image/svg+xml,' + encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">` +
                    `<polygon points="${points}" fill="#BBBBBB"/></svg>`
                ), 10, 10
            );
            graph.collapsedImage = mkFoldIcon('2,1 9,5 2,9');  // ▶
            graph.expandedImage  = mkFoldIcon('1,2 9,2 5,9');  // ▼

            // Default swimlane style
            const style = [];
            style[mxConstants.STYLE_SHAPE] = mxConstants.SHAPE_SWIMLANE;
            style[mxConstants.STYLE_PERIMETER] = mxPerimeter.RectanglePerimeter;
            style[mxConstants.STYLE_FONTCOLOR] = '#FFFFFF';
            style[mxConstants.STYLE_FILLCOLOR] = '#000066';
            style[mxConstants.STYLE_ROUNDED] = true;
            style[mxConstants.STYLE_FONTSIZE] = 13;
            style[mxConstants.STYLE_FONTSTYLE] = 0;
            style[mxConstants.STYLE_HORIZONTAL] = true;
            style[mxConstants.STYLE_LABEL_BACKGROUNDCOLOR] = '#000066';
            graph.getStylesheet().putCellStyle('swimlane', style);

            new mxRubberband(graph);

            // Enable left-button drag-to-pan
            graph.setPanning(true);
            graph.panningHandler.useLeftButtonForPanning = true;

            graph.getModel().beginUpdate();
            try {
                const xmlDocument = mxUtils.parseXml(graphXML);
                const decoder = new mxCodec(xmlDocument);
                decoder.decode(xmlDocument.documentElement, graph.getModel());

                const layout = new mxSwimlaneLayout(graph);
                layout.orientation = mxConstants.DIRECTION_SOUTH;
                layout.resizeParent = false;
                layout.execute(graph.getDefaultParent());
            } finally {
                graph.getModel().endUpdate();
            }

            // Scroll = pan, Ctrl+Scroll = zoom
            container.addEventListener('wheel', (evt) => {
                evt.preventDefault();
                if (evt.ctrlKey) {
                    if (evt.deltaY < 0) graph.zoomIn();
                    else graph.zoomOut();
                    if (global.App) global.App.updateZoomDisplay(graph.view.scale);
                } else {
                    graph.panGraph(evt.deltaX, evt.deltaY);
                }
            }, { passive: false });

            // Cell click → notify app for properties panel
            graph.addListener(mxEvent.CLICK, function (sender, evt) {
                const cell = evt.getProperty('cell');
                if (global.App?.onCellClick) global.App.onCellClick(cell ? cell.id : null);
            });

            this._instances[containerId] = { graph, container };
            if (global.App) global.App.updateZoomDisplay(graph.view.scale);
            return graph;
        }

        exportXML(containerId) {
            const inst = this._instances[containerId];
            if (!inst) return null;
            const enc = new mxCodec(mxUtils.createXmlDocument());
            const node = enc.encode(inst.graph.getModel());
            return mxUtils.getXml(node);
        }

        exportSVG(containerId) {
            const inst = this._instances[containerId];
            if (!inst) return null;
            const { graph } = inst;
            try {
                const bounds = graph.getGraphBounds();
                const vs = graph.view.scale;
                const w = Math.max(1, Math.ceil(bounds.width / vs) + 40);
                const h = Math.max(1, Math.ceil(bounds.height / vs) + 40);

                const doc = mxUtils.createXmlDocument();
                const svg = doc.createElement('svg');
                svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
                svg.setAttribute('width', w);
                svg.setAttribute('height', h);
                doc.appendChild(svg);

                const bg = doc.createElement('rect');
                bg.setAttribute('width', w);
                bg.setAttribute('height', h);
                bg.setAttribute('fill', '#0d1117');
                svg.appendChild(bg);

                const canvas = new mxSvgCanvas2D(svg);
                canvas.translate(
                    Math.floor(20 - bounds.x / vs),
                    Math.floor(20 - bounds.y / vs)
                );
                new mxImageExport().drawState(graph.getView().getState(graph.model.root), canvas);
                return mxUtils.getXml(svg);
            } catch (e) {
                console.error('[exportSVG]', e);
                return null;
            }
        }

        async exportPNG(containerId) {
            const svgStr = this.exportSVG(containerId);
            if (!svgStr) return null;
            const inst = this._instances[containerId];
            const bounds = inst.graph.getGraphBounds();
            const vs = inst.graph.view.scale;
            const w = Math.max(1, Math.ceil(bounds.width / vs) + 40);
            const h = Math.max(1, Math.ceil(bounds.height / vs) + 40);
            return new Promise(resolve => {
                const img = new Image();
                const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = '#0d1117';
                        ctx.fillRect(0, 0, w, h);
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(url);
                        canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : null), 'image/png');
                    } catch (e) {
                        URL.revokeObjectURL(url);
                        console.error('[exportPNG]', e);
                        resolve(null);
                    }
                };
                img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
                img.src = url;
            });
        }

        applyLayout(containerId) {
            const inst = this._instances[containerId];
            if (!inst) return;
            const { graph } = inst;
            graph.getModel().beginUpdate();
            try {
                const layout = new mxSwimlaneLayout(graph);
                layout.orientation = mxConstants.DIRECTION_SOUTH;
                layout.resizeParent = false;
                layout.execute(graph.getDefaultParent());
            } finally {
                graph.getModel().endUpdate();
            }
        }

        scrollToCell(containerId, cellId) {
            const inst = this._instances[containerId];
            if (!inst) return;
            const cell = inst.graph.getModel().getCell(String(cellId));
            if (cell) inst.graph.scrollCellToVisible(cell, true);
        }

        zoomIn(containerId) {
            const inst = this._instances[containerId];
            if (inst) {
                inst.graph.zoomIn();
                if (global.App) global.App.updateZoomDisplay(inst.graph.view.scale);
            }
        }

        zoomOut(containerId) {
            const inst = this._instances[containerId];
            if (inst) {
                inst.graph.zoomOut();
                if (global.App) global.App.updateZoomDisplay(inst.graph.view.scale);
            }
        }

        resetZoom(containerId) {
            const inst = this._instances[containerId];
            if (inst) {
                inst.graph.zoomActual();
                if (global.App) global.App.updateZoomDisplay(inst.graph.view.scale);
            }
        }

        fitPage(containerId) {
            const inst = this._instances[containerId];
            if (inst) {
                inst.graph.fit();
                if (global.App) global.App.updateZoomDisplay(inst.graph.view.scale);
            }
        }

        renderRouting(containerId, records, srcFmt, rcvType, sourceName, rcvMsgInfo, onNodeClick) {
            const container = document.getElementById(containerId);
            if (!container) return null;

            if (this._instances[containerId]) {
                this._instances[containerId].graph.destroy();
                delete this._instances[containerId];
            }

            function esc(s) {
                return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            }

            mxEvent.disableContextMenu(container);
            const graph = new mxGraph(container);
            graph.htmlLabels       = true;
            graph.setCellsEditable(false);
            graph.setConnectable(false);
            graph.isCellMovable    = () => false;
            graph.isCellResizable  = () => false;
            graph.isCellDeletable  = () => false;
            graph.setPanning(true);
            graph.panningHandler.useLeftButtonForPanning = true;

            container.addEventListener('wheel', (evt) => {
                evt.preventDefault();
                if (evt.ctrlKey) {
                    if (evt.deltaY < 0) graph.zoomIn(); else graph.zoomOut();
                    if (global.App) global.App.updateZoomDisplay(graph.view.scale);
                } else {
                    graph.panGraph(evt.deltaX, evt.deltaY);
                }
            }, { passive: false });

            /* ── Layout constants ── */
            const NW    = 300;  // non-conditional action width
            const NH    = 64;   // action height (reply / other — no dest line)
            const NHD   = 80;   // action height with destination line
            const NHDR  = 96;   // action height with destination + response lines
            const SSH   = 58;   // start node height (two lines)
            const SH    = 36;   // end node height
            const DW    = 160;  // diamond width
            const DH    = 56;   // diamond height
            const GAP   = 36;   // vertical gap between nodes
            const GAP_H = 20;   // horizontal gap: diamond right tip → conditional action
            const NX    = 40;   // non-conditional action left edge
            const CX    = NX + NW / 2;  // horizontal centre (= 190)
            const DX    = CX - DW / 2;  // diamond left edge  (= 110)
            const AX    = DX + DW + GAP_H;  // conditional action left edge (= 290)
            const AW    = 220;  // conditional action width

            /* ── Cell styles ── */
            const pill = 'rounded=1;arcSize=50;strokeWidth=1.5;fontSize=11;fontStyle=1;align=center;verticalAlign=middle;';
            const startStyle = pill + 'fillColor=#0c181e;strokeColor=#1e4860;fontColor=#3a98b8;';
            const endStyle   = pill + 'fillColor=#0c1c12;strokeColor=#1a5830;fontColor=#38a858;';
            const condStyle  = 'shape=rhombus;strokeWidth=1.5;fillColor=#1c1800;strokeColor=#6a5018;fontColor=#c09828;fontSize=10;fontStyle=2;align=center;verticalAlign=middle;';
            const actStyle = {
                transact:  'rounded=1;arcSize=4;strokeWidth=1.5;fillColor=#0c1824;strokeColor=#2a4870;align=left;verticalAlign=top;',
                translate: 'rounded=1;arcSize=4;strokeWidth=1.5;fillColor=#201800;strokeColor=#6a4c1a;align=left;verticalAlign=top;',
                reply:     'rounded=1;arcSize=4;strokeWidth=1.5;fillColor=#0c1e10;strokeColor=#1a6038;align=center;verticalAlign=middle;',
                other:     'rounded=1;arcSize=4;strokeWidth=1.5;fillColor=#1a2028;strokeColor=#404858;align=left;verticalAlign=top;',
            };
            const edgeBase   = 'edgeStyle=orthogonalEdgeStyle;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#50585e;endArrow=open;endSize=8;endFill=0;jettySize=auto;orthogonalLoop=1;';
            const edgeDashed = edgeBase + 'dashed=1;dashPattern=8 4;strokeColor=#2a4050;';

            /* ── HTML label for action nodes ── */
            function msgSpan(msgName, msgType, isResp, desc, color, fmtName) {
                const display = esc(msgName || msgType || '');
                const attrs   = `data-rclick="msg" data-msg-name="${esc(msgName||msgType)}" data-msg-type="${esc(msgType||'')}" data-msg-isresp="${isResp?'1':'0'}" data-msg-desc="${esc(desc||'')}" data-fmt-name="${esc(fmtName||'')}"`;
                return `<span ${attrs} style="color:${color};font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:2px">${display}</span>`;
            }

            function dstSpan(name, fmtName) {
                return `<span data-rclick="dst" data-dst-name="${esc(name)}" data-fmt-name="${esc(fmtName||'')}" style="color:#90bcd8;font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:2px">${esc(name)}</span>`;
            }

            function srcSpan(name) {
                return `<span data-rclick="src" data-src-name="${esc(name)}" data-fmt-name="${esc(srcFmt)}" style="color:#3a98b8;cursor:pointer;text-decoration:underline;text-underline-offset:2px">${esc(name)}</span>`;
            }

            function actionLabel(rec) {
                const act = (rec.Action || '').toLowerCase();
                const bg  = { transact:'#18304c', translate:'#382800', reply:'#0e3018' }[act] || '#283038';
                const fg  = { transact:'#5aaad8', translate:'#c09030', reply:'#38c060'  }[act] || '#8090a0';
                const tc  = { transact:'#90bcd8', translate:'#c0a060', reply:'#70c880'  }[act] || '#b0bcc8';
                const isP = rec.IsParallel === 1 || rec.IsParallel === true || rec.IsParallel === '1';

                const badge = `<span style="background:${bg};color:${fg};border-radius:9px;padding:1px 8px;font-size:9px;font-weight:700;letter-spacing:.5px">${act.toUpperCase()}</span>`;
                const seq   = rec.SeqNbr != null ? `<span style="color:#404858;font-family:monospace;font-size:9px;margin-left:6px">#${rec.SeqNbr}</span>` : '';
                const par   = isP ? `<span style="background:#0e2030;color:#3878a0;border-radius:9px;padding:1px 8px;font-size:9px;font-weight:700;margin-left:6px">‖ PARALLEL</span>` : '';

                const indent = 'style="padding-left:12px"';
                let body = '';
                if (act === 'reply') {
                    const ms = msgSpan(rec.OutputMsgName, rec.OutputMsgType, rec.OutputMsgIsResp, rec.OutputMsgDesc, tc, rec.OutputFormatName);
                    body = `<div style="margin-top:6px;text-align:center">↩ ${srcSpan(sourceName)} · ${ms}</div>`;
                } else if (act === 'transact') {
                    const ms = msgSpan(rec.OutputMsgName, rec.OutputMsgType, rec.OutputMsgIsResp, rec.OutputMsgDesc, tc, rec.OutputFormatName);
                    body = `<div style="margin-top:6px">${rec.Destination ? dstSpan(rec.Destination, rec.OutputFormatName) : ''}</div>`
                         + `<div ${indent}>→ ${ms}</div>`;
                    if (rec.ResponseMsgType) {
                        const rs = msgSpan(rec.ResponseMsgName, rec.ResponseMsgType, rec.ResponseMsgIsResp, rec.ResponseMsgDesc, '#38a858', rec.OutputFormatName);
                        body += `<div ${indent}>← ${rs}</div>`;
                    }
                } else if (act === 'translate') {
                    const ms = msgSpan(rec.OutputMsgName, rec.OutputMsgType, rec.OutputMsgIsResp, rec.OutputMsgDesc, tc, rec.OutputFormatName);
                    body = `<div style="margin-top:6px">${rec.Destination ? dstSpan(rec.Destination, rec.OutputFormatName) : ''}</div>`
                         + `<div ${indent}>→ ${ms}</div>`;
                    if (rec.ResponseMsgType) {
                        const rs = msgSpan(rec.ResponseMsgName, rec.ResponseMsgType, rec.ResponseMsgIsResp, rec.ResponseMsgDesc, '#38a858', rec.OutputFormatName);
                        body += `<div ${indent}>← ${rs}</div>`;
                    }
                } else {
                    const ms = msgSpan(rec.OutputMsgName, rec.OutputMsgType, rec.OutputMsgIsResp, rec.OutputMsgDesc, tc, rec.OutputFormatName);
                    const ds = rec.Destination ? dstSpan(rec.Destination, rec.OutputFormatName) : '';
                    body = `<div style="margin-top:6px">→ ${ms}${ds}</div>`;
                }

                return `<div style="padding:6px 10px;font-family:sans-serif;font-size:11px;line-height:1.4">`
                     + `<div>${badge}${seq}${par}</div>${body}</div>`;
            }

            const hEdge = 'edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#50585e;endArrow=open;endSize=8;endFill=0;jettySize=auto;orthogonalLoop=1;';

            const parent  = graph.getDefaultParent();
            const model   = graph.getModel();
            const nodeMap = {};  // cellId → record index
            const condMap = {};  // cellId → record index (condition diamonds)

            model.beginUpdate();
            try {
                let y = 20;

                /* Start node */
                const rmName  = rcvMsgInfo?.name  || '';
                const rmIsR   = rcvMsgInfo?.isResp ?? false;
                const rmDesc  = rcvMsgInfo?.desc   || '';
                const startLabel =
                    `<div style="padding:4px 10px;font-family:sans-serif;font-size:11px;line-height:1.5;text-align:center">` +
                    `<div>${srcSpan(sourceName || srcFmt)}</div>` +
                    `<div>← ${msgSpan(rmName || rcvType, rcvType, rmIsR, rmDesc, '#3a98b8', srcFmt)}</div>` +
                    `</div>`;
                const startNode = graph.insertVertex(parent, 'r-start', startLabel,
                    NX, y, NW, SSH, startStyle);
                y += SSH;

                let prev = startNode;

                records.forEach((rec, idx) => {
                    const isP   = rec.IsParallel === 1 || rec.IsParallel === true || rec.IsParallel === '1';
                    const eSt   = isP ? edgeDashed : edgeBase;
                    const hasCond = (rec.conditionID || 0) > 0;

                    const act  = (rec.Action || '').toLowerCase();
                    const st   = actStyle[act] || actStyle.other;
                    const hasDest = (act === 'transact' || act === 'translate') && rec.Destination;
                    const h    = ((act === 'transact' || act === 'translate') && rec.ResponseMsgType) ? NHDR : (hasDest ? NHD : NH);
                    const cid  = `r-rec-${idx}`;

                    if (hasCond) {
                        const condLabel = rec.ConditionName
                            ? `<span style="font-family:sans-serif;font-size:10px;font-weight:700">${esc(rec.ConditionName)}</span>`
                            : `<span style="font-family:sans-serif;font-size:10px;font-style:italic">Condition ${rec.conditionID}</span>`;
                        const condId = `r-cond-${idx}`;
                        // Vertically centre the shorter shape relative to the taller one
                        const pairH = Math.max(DH, h);
                        const dy    = Math.round((pairH - DH) / 2);
                        const ay    = Math.round((pairH - h)  / 2);
                        const cond  = graph.insertVertex(parent, condId, condLabel,
                            DX, y + GAP + dy, DW, DH, condStyle);
                        const cell  = graph.insertVertex(parent, cid, actionLabel(rec),
                            AX, y + GAP + ay, AW, h, st);
                        graph.insertEdge(parent, null, '', prev, cond, eSt);
                        graph.insertEdge(parent, null, '', cond, cell, hEdge);
                        condMap[condId] = idx;
                        nodeMap[cid]    = idx;
                        y    += GAP + pairH;
                        prev  = cond;
                    } else {
                        const cell = graph.insertVertex(parent, cid, actionLabel(rec), NX, y + GAP, NW, h, st);
                        graph.insertEdge(parent, null, '', prev, cell, eSt);
                        nodeMap[cid] = idx;
                        y    += GAP + h;
                        prev  = cell;
                    }
                });

                /* End node */
                const endNode = graph.insertVertex(parent, 'r-end',
                    `<span style="font-family:monospace;font-size:11px;font-weight:600">Complete</span>`,
                    NX, y + GAP, NW, SH, endStyle);
                graph.insertEdge(parent, null, '', prev, endNode, edgeBase);

            } finally {
                model.endUpdate();
            }

            graph.fit(20);

            graph.addListener(mxEvent.CLICK, function (sender, evt) {
                const cell    = evt.getProperty('cell');
                const domEvt  = evt.getProperty('event');
                const rEl     = domEvt?.target?.closest?.('[data-rclick]');
                const recIdx  = cell ? (nodeMap[cell.id] ?? null) : null;
                const condIdx = cell ? (condMap[cell.id] ?? null) : null;
                if (!onNodeClick) return;
                if (rEl)              onNodeClick(cell?.id ?? null, recIdx, rEl.dataset);
                else if (condIdx != null) onNodeClick(cell?.id ?? null, null, { rclick: 'cond', condIdx: String(condIdx) });
                else                  onNodeClick(cell?.id ?? null, recIdx, null);
            });

            this._instances[containerId] = { graph, container };
            if (global.App) global.App.updateZoomDisplay(graph.view.scale);
            return graph;
        }

        destroy(containerId) {
            const inst = this._instances[containerId];
            if (inst) {
                inst.graph.destroy();
                delete this._instances[containerId];
            }
        }

        getGraph(containerId) {
            return this._instances[containerId]?.graph || null;
        }
    }

    global.DiagramManager = new DiagramManager();
})(window);

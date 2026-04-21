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

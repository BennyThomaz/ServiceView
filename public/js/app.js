/* Unity Service View — main application */
(function () {
    'use strict';

    /* ─── State ─────────────────────────────────────────────── */
    let tabs = [];           // [{ id, name, type, containerId, services, nodeProps, serviceIds }]
    let activeTabId = null;
    let tabCounter = 0;
    let selectedService = null;  // service name string | null
    let isZoomed = false;
    let hiddenConnTypes = new Set();  // commsType strings currently filtered out

    /* ─── Connection type definitions ──────────────────────── */
    const CONN_TYPE_DEFS = [
        { type: 'tcp',   label: 'TCP',       color: '#7086A0' },
        { type: 'http',  label: 'HTTP',       color: '#A08070' },
        { type: 'db',    label: 'Database',   color: '#70A086' },
        { type: 'WSO',   label: 'WebSocket',  color: '#8070A0' },
        { type: 'api',   label: 'Web API',    color: '#6880A0' },
        { type: 'amq',   label: 'AMQP',       color: '#A07080' },
        { type: 'ICE',   label: 'ICE',        color: '#A09060' },
        { type: 'IBMMQ', label: 'IBM MQ',     color: '#A06878' },
        { type: 'file',  label: 'File',       color: '#708070' },
    ];

    /* ─── DOM refs ──────────────────────────────────────────── */
    const tabBar         = document.getElementById('tab-bar');
    const diagramArea    = document.getElementById('diagram-area');
    const welcome        = document.getElementById('welcome');
    const zoomLevel      = document.getElementById('zoom-level');
    const statusFile     = document.getElementById('status-file');
    const statusSvcs     = document.getElementById('status-svcs');
    const statusConns    = document.getElementById('status-conns');
    const sidebarSvcs    = document.getElementById('sidebar-services');
    const spinnerOverlay = document.getElementById('spinner-overlay');
    const propsPanel     = document.getElementById('props-panel');
    const focusBar       = document.getElementById('service-focus-bar');
    const focusName      = document.getElementById('service-focus-name');
    const focusIconZoom  = document.getElementById('focus-icon-zoom');
    const focusIconUnzoom= document.getElementById('focus-icon-unzoom');
    const focusBtnLabel  = document.getElementById('focus-btn-label');
    const connTypeFilters= document.getElementById('conn-type-filters');
    const appEl          = document.getElementById('app');

    const CLS = {
        active:          'active',
        dimmed:          'dimmed',
        open:            'open',
        visible:         'visible',
        hidden:          'hidden',
        propsCollapsed:  'props-collapsed',
        sidebarCollapsed:'sidebar-collapsed',
        gridVisible:     'grid-visible',
    };

    /* ─── Properties panel ──────────────────────────────────── */
    const PropertiesPanel = {
        show(props) {
            const el = propsPanel;
            if (!el) return;

            const addr = props.basic?.address || '';
            const copyBtn = addr
                ? `<button class="props-copy-btn" data-copy="${escHtml(addr)}" title="Copy address"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`
                : '';

            let html = `<div class="props-node-header">
                <span class="props-node-name">${escHtml(props.name || '—')}</span>
                <span class="props-badge ${props.isSource ? 'props-badge-src' : 'props-badge-dest'}">${props.isSource ? 'Source' : 'Dest'}</span>
            </div>
            <div class="props-service-name">${escHtml(props.serviceName || '')}</div>`;

            html += `<div class="props-category">Basic</div>
            <table class="props-table">
                <tr><td class="props-key">class</td><td class="props-val">${escHtml(props.basic?.class)}</td></tr>
                <tr><td class="props-key">address</td><td class="props-val props-copyable"><span>${escHtml(addr)}</span>${copyBtn}</td></tr>
                <tr><td class="props-key">timeout</td><td class="props-val">${escHtml(props.basic?.timeout)}</td></tr>
            </table>`;

            html += `<div class="props-category">Adaptor Properties</div>`;
            if (props.params?.length) {
                html += `<table class="props-table">`;
                for (const p of props.params) {
                    if (p.isIncludeHeader) {
                        html += `<tr class="props-include-row"><td colspan="2">${escHtml(p.section)}</td></tr>`;
                    } else {
                        html += `<tr><td class="props-key">${escHtml(p.key)}</td><td class="props-val">${escHtml(p.value)}</td></tr>`;
                    }
                }
                html += `</table>`;
            } else {
                html += `<div class="props-placeholder">No adaptor configuration</div>`;
            }

            el.innerHTML = html;

            el.querySelectorAll('.props-copy-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    navigator.clipboard.writeText(btn.dataset.copy)
                        .then(() => showToast('Address copied', 'success'))
                        .catch(() => showToast('Copy failed', 'error'));
                });
            });

            appEl?.classList.remove(CLS.propsCollapsed);
        },

        showService(name, deps) {
            const el = propsPanel;
            if (!el) return;

            let html = `<div class="props-node-header">
                <span class="props-node-name">${escHtml(name)}</span>
                <span class="props-badge props-badge-svc">Service</span>
            </div>`;

            html += `<div class="props-category">Calls (${deps.callees.length})</div>`;
            if (deps.callees.length) {
                html += `<div class="props-dep-list">`;
                for (const c of deps.callees) {
                    html += `<div class="props-dep-item" data-goto="${escHtml(c)}">${escHtml(c)}</div>`;
                }
                html += '</div>';
            } else {
                html += '<div class="props-placeholder">No outgoing connections</div>';
            }

            html += `<div class="props-category">Called by (${deps.callers.length})</div>`;
            if (deps.callers.length) {
                html += `<div class="props-dep-list">`;
                for (const c of deps.callers) {
                    html += `<div class="props-dep-item" data-goto="${escHtml(c)}">${escHtml(c)}</div>`;
                }
                html += '</div>';
            } else {
                html += '<div class="props-placeholder">No incoming connections</div>';
            }

            el.innerHTML = html;

            el.querySelectorAll('.props-dep-item[data-goto]').forEach(item => {
                item.addEventListener('click', () => {
                    selectService(item.dataset.goto);
                    scrollToService(item.dataset.goto);
                });
            });

            appEl?.classList.remove(CLS.propsCollapsed);
        },

        clear() {
            if (propsPanel) propsPanel.innerHTML = '<div class="props-placeholder">Click a node to view properties</div>';
        }
    };

    /* ─── Service focus / zoom ──────────────────────────────── */
    function getTopLevel(cell) {
        let c = cell;
        while (c && c.parent && c.parent.id !== '1' && c.parent.id !== '0') c = c.parent;
        return c;
    }

    function getCellLabel(cell) {
        if (!cell || !cell.value) return '';
        if (typeof cell.value === 'string') return cell.value;
        if (cell.value.getAttribute) return cell.value.getAttribute('label') || '';
        return '';
    }

    function buildFocusSet(model, cells, tab) {
        const svcContainerIds = new Set(Object.values(tab.serviceIds || {}));
        const selContId = tab.serviceIds?.[selectedService];
        if (!selContId) return null;

        const visContainers = new Set([selContId]);
        const visEdges = new Set();
        const queue = [selContId];

        while (queue.length) {
            const contId = queue.shift();
            for (const id in cells) {
                const cell = cells[id];
                if (!model.isEdge(cell) || !cell.source || !cell.target) continue;
                const srcTop = getTopLevel(cell.source);
                const tgtTop = getTopLevel(cell.target);
                if (!srcTop || !tgtTop) continue;
                if (srcTop.id === contId || tgtTop.id === contId) {
                    visEdges.add(id);
                    const otherId = srcTop.id === contId ? tgtTop.id : srcTop.id;
                    if (!visContainers.has(otherId)) {
                        visContainers.add(otherId);
                        if (svcContainerIds.has(otherId)) queue.push(otherId);
                    }
                }
            }
        }
        return new Set([...visContainers, ...visEdges]);
    }

    function applyVisibility() {
        if (!activeTabId) return;
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        const graph = DiagramManager.getGraph(tab.containerId);
        if (!graph) return;

        const model = graph.getModel();
        const cells = model.cells;
        const focusSet = isZoomed ? buildFocusSet(model, cells, tab) : null;

        model.beginUpdate();
        try {
            for (const id in cells) {
                const cell = cells[id];
                if (!cell || cell.id === '0' || cell.id === '1') continue;
                if (cell.parent?.id !== '1') continue;

                let visible = focusSet ? focusSet.has(cell.id) : true;

                if (visible && model.isEdge(cell) && hiddenConnTypes.size > 0) {
                    const ct = cell.getAttribute ? cell.getAttribute('commsType') : null;
                    if (ct && hiddenConnTypes.has(ct)) visible = false;
                }

                model.setVisible(cell, visible);
            }
        } finally {
            model.endUpdate();
        }
    }

    function updateFocusBtn() {
        if (!selectedService || !activeTabId) {
            focusBar.classList.remove(CLS.visible);
            return;
        }
        focusBar.classList.add(CLS.visible);
        focusName.textContent         = selectedService;
        focusIconZoom.style.display   = isZoomed ? 'none' : '';
        focusIconUnzoom.style.display = isZoomed ? '' : 'none';
        focusBtnLabel.textContent     = isZoomed ? 'Show All' : 'Focus';
        document.getElementById('btn-focus-service').title = isZoomed ? 'Show all services' : 'Focus on ' + selectedService;
    }

    function selectService(name) {
        selectedService = name || null;
        if (isZoomed) {
            if (selectedService) zoomGraph();
            else unzoomGraph();
        }
        updateFocusBtn();
        document.querySelectorAll('#sidebar-services .sidebar-item[data-service]').forEach(el => {
            el.classList.toggle(CLS.active, el.dataset.service === selectedService);
        });
    }

    function zoomGraph() {
        if (!selectedService || !activeTabId) return;
        isZoomed = true;
        applyVisibility();
        updateFocusBtn();
    }

    function unzoomGraph() {
        if (!activeTabId) return;
        isZoomed = false;
        applyVisibility();
        updateFocusBtn();
    }

    function getServiceDeps(graph, tab, serviceName) {
        const model = graph.getModel();
        const cells = model.cells;
        const svcContId = tab.serviceIds?.[serviceName];
        if (!svcContId) return { callers: [], callees: [] };

        const svcIdToName = Object.fromEntries(Object.entries(tab.serviceIds).map(([n, id]) => [id, n]));
        const callerNames = new Set();
        const calleeNames = new Set();

        for (const id in cells) {
            const cell = cells[id];
            if (!model.isEdge(cell) || !cell.source || !cell.target) continue;
            const srcTop = getTopLevel(cell.source);
            const tgtTop = getTopLevel(cell.target);
            if (!srcTop || !tgtTop) continue;

            if (tgtTop.id === svcContId && srcTop.id !== svcContId) {
                const n = svcIdToName[srcTop.id];
                if (n) callerNames.add(n);
            }
            if (srcTop.id === svcContId && tgtTop.id !== svcContId) {
                const n = svcIdToName[tgtTop.id];
                if (n) {
                    calleeNames.add(n);
                } else {
                    const label = getCellLabel(model.getCell(tgtTop.id));
                    if (label) calleeNames.add(label);
                }
            }
        }
        return { callers: [...callerNames], callees: [...calleeNames] };
    }

    function scrollToService(name) {
        if (!activeTabId) return;
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        const cellId = tab.serviceIds?.[name];
        if (cellId) DiagramManager.scrollToCell(tab.containerId, cellId);
    }

    document.getElementById('btn-focus-service').addEventListener('click', () => {
        if (isZoomed) unzoomGraph();
        else zoomGraph();
    });

    /* ─── Connection type filter ────────────────────────────── */
    (function initConnTypeFilters() {
        const container = connTypeFilters;
        if (!container) return;
        for (const def of CONN_TYPE_DEFS) {
            const btn = document.createElement('div');
            btn.className = 'conn-type-btn';
            btn.dataset.type = def.type;
            btn.innerHTML = `<div class="legend-dot" style="background:${def.color}"></div>${def.label}`;
            btn.addEventListener('click', () => {
                if (hiddenConnTypes.has(def.type)) {
                    hiddenConnTypes.delete(def.type);
                    btn.classList.remove(CLS.dimmed);
                } else {
                    hiddenConnTypes.add(def.type);
                    btn.classList.add(CLS.dimmed);
                }
                applyVisibility();
            });
            container.appendChild(btn);
        }
    })();

    /* ─── Expose global API for DiagramManager callbacks ─── */
    window.App = {
        updateZoomDisplay(scale) {
            zoomLevel.textContent = Math.round(scale * 100) + '%';
        },
        onCellClick(cellId) {
            if (!activeTabId) return;
            const tab = tabs.find(t => t.id === activeTabId);
            if (!tab) return;
            if (!cellId) { PropertiesPanel.clear(); return; }
            const cid = String(cellId);
            const serviceName = Object.entries(tab.serviceIds || {}).find(([, id]) => id === cid)?.[0];
            if (serviceName) {
                selectService(serviceName);
                const graph = DiagramManager.getGraph(tab.containerId);
                if (graph) PropertiesPanel.showService(serviceName, getServiceDeps(graph, tab, serviceName));
                return;
            }
            const props = tab.nodeProps?.[cid];
            if (props) { selectService(props.serviceName); PropertiesPanel.show(props); }
            else { PropertiesPanel.clear(); }
        }
    };

    /* ─── Props panel collapse toggle ───────────────────────── */
    document.getElementById('btn-toggle-props').addEventListener('click', () => {
        appEl.classList.toggle(CLS.propsCollapsed);
    });

    /* ─── Helpers ───────────────────────────────────────────── */
    function withActiveTab(fn) {
        const t = activeTabId ? tabs.find(x => x.id === activeTabId) : null;
        if (t) fn(t);
    }

    function closeDropdowns() {
        document.querySelectorAll('.dropdown-menu.' + CLS.open).forEach(m => m.classList.remove(CLS.open));
    }

    /* ─── Dropdown menus ────────────────────────────────────── */
    document.querySelectorAll('.dropdown').forEach(dd => {
        const btn = dd.querySelector('.nav-btn');
        const menu = dd.querySelector('.dropdown-menu');
        btn.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('.dropdown-menu.' + CLS.open).forEach(m => { if (m !== menu) m.classList.remove(CLS.open); });
            menu.classList.toggle(CLS.open);
        });
    });
    document.addEventListener('click', closeDropdowns);

    /* ─── Upload modal ──────────────────────────────────────── */
    const uploadOverlay  = document.getElementById('upload-overlay');
    const uploadTitle    = document.getElementById('upload-modal-title');
    const uploadForm     = document.getElementById('upload-form');
    const uploadModeInput = document.getElementById('upload-mode');
    const configFields   = document.getElementById('config-fields');
    const jsonFields     = document.getElementById('json-fields');
    const diagramFields  = document.getElementById('diagram-fields');

    function openUploadModal(mode) {
        uploadModeInput.value = mode;
        uploadTitle.textContent = {
            config:  'Open V4 Config File (.config)',
            json:    'Open V6+ Settings',
            diagram: 'Open Saved Diagram (.xml)'
        }[mode];
        configFields.style.display  = mode === 'config'  ? '' : 'none';
        jsonFields.style.display    = mode === 'json'    ? '' : 'none';
        diagramFields.style.display = mode === 'diagram' ? '' : 'none';
        uploadForm.reset();
        uploadOverlay.classList.add(CLS.open);
        closeDropdowns();
    }

    document.getElementById('btn-open-config').addEventListener('click',  () => openUploadModal('config'));
    document.getElementById('btn-open-json').addEventListener('click',    () => openUploadModal('json'));
    document.getElementById('btn-open-diagram').addEventListener('click', () => openUploadModal('diagram'));
    document.getElementById('btn-open-config-welcome').addEventListener('click',  () => openUploadModal('config'));
    document.getElementById('btn-open-json-welcome').addEventListener('click',    () => openUploadModal('json'));
    document.getElementById('btn-open-diag-welcome').addEventListener('click',    () => openUploadModal('diagram'));

    document.getElementById('modal-cancel').addEventListener('click', () => uploadOverlay.classList.remove(CLS.open));
    uploadOverlay.addEventListener('click', e => { if (e.target === uploadOverlay) uploadOverlay.classList.remove(CLS.open); });

    /* ─── Drop zone visual ──────────────────────────────────── */
    const dropZone = document.getElementById('drop-zone');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        const mode = uploadModeInput.value;
        autoAssignDroppedFiles(files, mode);
    });
    dropZone.addEventListener('click', () => {
        const mode = uploadModeInput.value;
        if (mode === 'config') document.getElementById('input-config').click();
        else if (mode === 'json') document.getElementById('input-json').click();
        else document.getElementById('input-diagram').click();
    });

    function autoAssignDroppedFiles(files, mode) {
        if (mode === 'config' && files[0]) {
            const dt = new DataTransfer();
            dt.items.add(files[0]);
            document.getElementById('input-config').files = dt.files;
        } else if (mode === 'json') {
            for (const f of files) {
                const dt = new DataTransfer();
                dt.items.add(f);
                if (f.name.endsWith('.json')) document.getElementById('input-json').files = dt.files;
                else if (f.name.endsWith('.xml')) document.getElementById('input-xml').files = dt.files;
            }
        } else if (mode === 'diagram' && files[0]) {
            const dt = new DataTransfer();
            dt.items.add(files[0]);
            document.getElementById('input-diagram').files = dt.files;
        }
    }

    /* ─── Form submission ───────────────────────────────────── */
    uploadForm.addEventListener('submit', async e => {
        e.preventDefault();
        const mode = uploadModeInput.value;
        const formData = new FormData();
        let fileName = 'diagram';

        if (mode === 'config') {
            const file = document.getElementById('input-config').files[0];
            if (!file) return showToast('Select a .config file', 'error');
            formData.append('configFile', file);
            fileName = file.name;
        } else if (mode === 'json') {
            const jsonFile = document.getElementById('input-json').files[0];
            const xmlFile  = document.getElementById('input-xml').files[0];
            if (!jsonFile || !xmlFile) return showToast('Select both JSON and DynamicAdaptor.xml files', 'error');
            formData.append('jsonFile', jsonFile);
            formData.append('xmlFile', xmlFile);
            fileName = jsonFile.name;
        } else if (mode === 'diagram') {
            const file = document.getElementById('input-diagram').files[0];
            if (!file) return showToast('Select a diagram .xml file', 'error');
            formData.append('diagramFile', file);
            fileName = file.name;
        }

        uploadOverlay.classList.remove(CLS.open);
        spinnerOverlay.classList.add(CLS.active);

        try {
            const endpoint = { config: '/api/load/config', json: '/api/load/json', diagram: '/api/load/diagram' }[mode];
            const resp = await fetch(endpoint, { method: 'POST', body: formData });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Server error');
            spinnerOverlay.classList.remove(CLS.active);
            createTab(data.fileName || fileName, mode, data.graphXML, data.services || [], data.nodeProps || {}, data.serviceIds || {});
        } catch (err) {
            spinnerOverlay.classList.remove(CLS.active);
            showToast(err.message, 'error');
        }
    });

    /* ─── Tab management ────────────────────────────────────── */
    function createTab(fileName, type, graphXML, services, nodeProps, serviceIds, { pinned = false } = {}) {
        const id = ++tabCounter;
        const containerId = 'graph-' + id;
        const tab = { id, name: fileName, type, containerId, services, graphXML, nodeProps: nodeProps || {}, serviceIds: serviceIds || {}, pinned };
        tabs.push(tab);

        // Tab button
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.tabId = id;
        const closeBtn = pinned ? '' : `<span class="tab-close" data-close="${id}" title="Close">×</span>`;
        tabEl.innerHTML = `
            <span class="tab-type-badge tab-type-${type}">${type}</span>
            <span class="tab-name" title="${escHtml(fileName)}">${escHtml(fileName)}</span>
            ${closeBtn}`;
        tabEl.addEventListener('click', e => {
            if (e.target.dataset.close) { closeTab(+e.target.dataset.close); return; }
            activateTab(id);
        });
        tabBar.appendChild(tabEl);

        // Diagram pane
        const pane = document.createElement('div');
        pane.className = 'graph-pane';
        pane.id = 'pane-' + id;

        const gcDiv = document.createElement('div');
        gcDiv.className = 'graph-container';
        gcDiv.id = containerId;
        pane.appendChild(gcDiv);

        diagramArea.appendChild(pane);

        activateTab(id);

        requestAnimationFrame(() => {
            DiagramManager.render(containerId, graphXML)
                .then(() => { updateStatus(); applyVisibility(); })
                .catch(err => showToast('Diagram error: ' + err.message, 'error'));
        });
    }

    function activateTab(id) {
        activeTabId = id;
        tabs.forEach(t => {
            const tabEl = tabBar.querySelector(`[data-tab-id="${t.id}"]`);
            const paneEl = document.getElementById('pane-' + t.id);
            if (t.id === id) {
                tabEl?.classList.add(CLS.active);
                paneEl?.classList.add(CLS.active);
            } else {
                tabEl?.classList.remove(CLS.active);
                paneEl?.classList.remove(CLS.active);
            }
        });

        welcome.classList.add(CLS.hidden);
        selectedService = null;
        isZoomed = false;
        updateFocusBtn();
        PropertiesPanel.clear();
        updateStatus();
        updateSidebar();
        applyVisibility();

        // Refresh zoom display
        const tab = tabs.find(t => t.id === id);
        if (tab) {
            const graph = DiagramManager.getGraph(tab.containerId);
            if (graph) App.updateZoomDisplay(graph.view.scale);
        }
    }

    function closeTab(id) {
        const idx = tabs.findIndex(t => t.id === id);
        if (idx === -1 || tabs[idx].pinned) return;
        const tab = tabs[idx];

        DiagramManager.destroy(tab.containerId);
        tabBar.querySelector(`[data-tab-id="${id}"]`)?.remove();
        document.getElementById('pane-' + id)?.remove();
        tabs.splice(idx, 1);

        if (activeTabId === id) {
            if (isZoomed) { isZoomed = false; } // graph destroyed, no need to unzoom
            if (tabs.length > 0) {
                activateTab(tabs[Math.max(0, idx - 1)].id);
            } else {
                activeTabId = null;
                selectedService = null;
                isZoomed = false;
                updateFocusBtn();
                welcome.classList.remove(CLS.hidden);
                updateStatus();
                updateSidebar();
            }
        }
    }

    /* ─── Save diagram ──────────────────────────────────────── */
    document.getElementById('btn-save-diagram').addEventListener('click', saveDiagram);
    document.getElementById('btn-save-toolbar').addEventListener('click', saveDiagram);

    function saveDiagram() {
        closeDropdowns();
        if (!activeTabId) return showToast('No diagram open', 'error');
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        const xml = DiagramManager.exportXML(tab.containerId);
        if (!xml) return showToast('Could not export diagram', 'error');
        const blob = new Blob([xml], { type: 'application/xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = tab.name.replace(/\.[^.]+$/, '') + '-diagram.xml';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Diagram saved', 'success');
    }

    /* ─── Zoom controls ─────────────────────────────────────── */
    document.getElementById('btn-zoom-in').addEventListener('click',    () => withActiveTab(t => DiagramManager.zoomIn(t.containerId)));
    document.getElementById('btn-zoom-out').addEventListener('click',   () => withActiveTab(t => DiagramManager.zoomOut(t.containerId)));
    document.getElementById('btn-zoom-reset').addEventListener('click', () => withActiveTab(t => DiagramManager.resetZoom(t.containerId)));
    document.getElementById('btn-fit-page').addEventListener('click',   () => withActiveTab(t => DiagramManager.fitPage(t.containerId)));

    /* ─── Sidebar ────────────────────────────────────────────── */
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
        appEl.classList.toggle(CLS.sidebarCollapsed);
    });

    /* ─── Grid toggle ───────────────────────────────────────── */
    document.getElementById('btn-toggle-grid').addEventListener('click', function () {
        this.classList.toggle(CLS.active);
        document.querySelectorAll('.graph-container').forEach(c => c.classList.toggle(CLS.gridVisible));
    });

    function updateSidebar() {
        sidebarSvcs.innerHTML = '';
        if (!activeTabId) return;
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab || !tab.services.length) {
            sidebarSvcs.innerHTML = '<div class="sidebar-item" style="opacity:.5;cursor:default;font-style:italic">No services</div>';
            return;
        }

        // Group by serviceGroup
        const groups = {};
        for (const s of tab.services) {
            const g = s.serviceGroup || 'Default';
            if (!groups[g]) groups[g] = [];
            groups[g].push(s.name);
        }

        for (const [grp, names] of Object.entries(groups)) {
            const titleEl = document.createElement('div');
            titleEl.className = 'sidebar-section-title';
            titleEl.textContent = grp;
            sidebarSvcs.appendChild(titleEl);
            for (const name of names) {
                const item = document.createElement('div');
                item.className = 'sidebar-item' + (name === selectedService ? ' active' : '');
                item.dataset.service = name;
                item.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2" opacity=".6"/></svg>${escHtml(name)}`;
                item.addEventListener('click', () => { selectService(name); scrollToService(name); });
                sidebarSvcs.appendChild(item);
            }
        }
    }

    /* ─── Status bar ─────────────────────────────────────────── */
    function updateStatus() {
        if (!activeTabId) {
            statusFile.textContent = 'No file open';
            statusSvcs.textContent = '–';
            statusConns.textContent = '–';
            return;
        }
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        statusFile.textContent = tab.name;
        statusSvcs.textContent = tab.services.length || '–';

        const graph = DiagramManager.getGraph(tab.containerId);
        if (graph) {
            const model = graph.getModel();
            let edges = 0;
            const cells = model.cells;
            for (const key in cells) {
                if (model.isEdge(cells[key])) edges++;
            }
            statusConns.textContent = edges || '–';
        }
    }

    /* ─── Toast notifications ────────────────────────────────── */
    function showToast(msg, type = 'info') {
        const area = document.getElementById('toast-area');
        const el = document.createElement('div');
        el.className = 'toast ' + type;
        el.innerHTML = `<div class="toast-dot"></div>${escHtml(msg)}`;
        area.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    /* ─── Sidebar search ────────────────────────────────────── */
    document.getElementById('sidebar-search')?.addEventListener('input', function () {
        const q = this.value.toLowerCase().trim();
        document.querySelectorAll('#sidebar-services .sidebar-item[data-service]').forEach(el => {
            el.style.display = (!q || el.dataset.service.toLowerCase().includes(q)) ? '' : 'none';
        });
    });
    document.getElementById('sidebar-search')?.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        const q = this.value.toLowerCase().trim();
        const matches = [...document.querySelectorAll('#sidebar-services .sidebar-item[data-service]')]
            .filter(el => el.style.display !== 'none');
        if (matches.length === 1) {
            const name = matches[0].dataset.service;
            selectService(name);
            scrollToService(name);
        }
    });

    /* ─── Export / Auto-Layout ──────────────────────────────── */
    document.getElementById('btn-export-svg').addEventListener('click', () => {
        closeDropdowns();
        if (!activeTabId) return showToast('No diagram open', 'error');
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        const svg = DiagramManager.exportSVG(tab.containerId);
        if (!svg) return showToast('SVG export failed', 'error');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        a.download = tab.name.replace(/\.[^.]+$/, '') + '.svg';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Exported as SVG', 'success');
    });

    document.getElementById('btn-export-png').addEventListener('click', async () => {
        closeDropdowns();
        if (!activeTabId) return showToast('No diagram open', 'error');
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        spinnerOverlay.classList.add(CLS.active);
        const url = await DiagramManager.exportPNG(tab.containerId);
        spinnerOverlay.classList.remove(CLS.active);
        if (!url) return showToast('PNG export failed', 'error');
        const a = document.createElement('a');
        a.href = url;
        a.download = tab.name.replace(/\.[^.]+$/, '') + '.png';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Exported as PNG', 'success');
    });

    document.getElementById('btn-auto-layout').addEventListener('click', () => {
        closeDropdowns();
        if (!activeTabId) return showToast('No diagram open', 'error');
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        DiagramManager.applyLayout(tab.containerId);
        showToast('Layout applied', 'success');
    });

    /* ─── Keyboard shortcuts ─────────────────────────────────── */
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveDiagram(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); openUploadModal('config'); }
        if ((e.ctrlKey || e.metaKey) && e.key === '=') { e.preventDefault(); document.getElementById('btn-zoom-in').click(); }
        if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); document.getElementById('btn-zoom-out').click(); }
        if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); document.getElementById('btn-zoom-reset').click(); }
    });

    /* ─── Default diagram (server-side path argument) ──────────── */
    (async function loadDefaultDiagram() {
        try {
            const resp = await fetch('/api/default-diagram');
            if (!resp.ok || resp.status === 204) return;
            const data = await resp.json();
            if (data.graphXML) {
                createTab(data.fileName || 'Default', 'json', data.graphXML, data.services || [], data.nodeProps || {}, data.serviceIds || {}, { pinned: true });
            }
        } catch {
            // No default diagram available
        }
    })();

    /* ─── Util ───────────────────────────────────────────────── */
    function escHtml(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
})();

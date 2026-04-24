// Darker pastel group header colours — muted, desaturated, harmonious
const GRP_COLORS = ['#3E5F78','#3A7068','#6E4E3A','#503A70','#3A6850','#705A3A','#683A58'];
const GRP_FONT_COLORS = ['#C0D8EC','#B8D8D0','#ECD8C4','#D4C0EC','#BCDACC','#ECD8BC','#ECC4D8'];

// Dark interior aligns the swimlane body with the app background, keeping the coloured header as focal point
const SRVC_STYLE = 'swimlane;rotation=1;labelBackgroundColor=none;swimlaneFillColor=#1a1d23;fillColor={fillColor};fontColor={fontColor};fontSize=12;fontStyle=1;glass=0;swimlaneLine=1;rounded=1;shadow=0;sketch=0;';
const DEST_CONTAINER_STYLE = 'swimlane;rotation=1;labelBackgroundColor=none;swimlaneFillColor=#1a1618;fillColor=#5C3A3A;fontColor=#0F0F0F;glass=0;swimlaneLine=1;rounded=1;shadow=1;sketch=0;';
const AMQP_BROKER_STYLE = 'swimlane;rotation=1;labelBackgroundColor=none;swimlaneFillColor=#1a1618;fillColor=#4A2A38;fontColor=#0F0F0F;glass=0;swimlaneLine=1;rounded=1;shadow=1;sketch=0;';
const IBMMQ_BROKER_STYLE = 'swimlane;rotation=1;labelBackgroundColor=none;swimlaneFillColor=#1a1618;fillColor=#2A3848;fontColor=#0F0F0F;glass=0;swimlaneLine=1;rounded=1;shadow=1;sketch=0;';
const FILESYSTEM_STYLE    = 'swimlane;rotation=1;labelBackgroundColor=none;swimlaneFillColor=#1a1a1a;fillColor=#3A4A3A;fontColor=#0F0F0F;glass=0;swimlaneLine=1;rounded=1;shadow=1;sketch=0;';
const DB_DEST_STYLE = 'shape=Database;whiteSpace=wrap;html=1;strokeColor=#3A6860;strokeWidth=2;fillColor=#2A4848;fontColor=#90C0C0;gradientColor=none;';
// Source nodes: dark amber — warm, sender-side identity
const DEST_STYLE = 'rounded=1;whiteSpace=wrap;html=1;rotation=0;fillColor=#1C2A34;strokeColor=#365070;fontColor=#88AEC8;fontSize=11;fontStyle=1;movable=0;deletable=0;resizable=0;';
// Destination nodes: dark steel-blue — cool, receiver-side identity
const SRC_STYLE  = 'rounded=1;whiteSpace=wrap;html=1;rotation=0;fillColor=#3D3218;strokeColor=#5A4C28;fontColor=#C8B878;fontSize=11;fontStyle=1;movable=0;deletable=0;resizable=0;';
const CONNECTOR_STYLE = 'endArrow=classic;startArrow=classic;html=1;strokeWidth=2;strokeColor={color};movable=0;deletable=0;';

// Muted pastel-jewel palette — harmonises with GRP_COLORS headers, avoids vibrancy clash
const CONN_COLORS = {
    tcp:   '#7086A0', // muted blue-grey
    http:  '#A08070', // muted copper-rose
    db:    '#70A086', // muted sage-green
    WSO:   '#8070A0', // muted dusty purple
    api:   '#6880A0', // muted periwinkle (distinct from tcp)
    amq:   '#A07080', // muted rose-red
    ICE:   '#A09060', // muted khaki-gold
    IBMMQ: '#A06878', // muted berry
    file:  '#708070', // muted olive-grey
};
const DEFAULT_ARROW_COLOR = '#6a737d';

const DEFAULT_CONN_STR = 'WPSConnectionString';

const LAYOUT = {
    SWIMLANE_X_START:   10,
    SWIMLANE_Y_START:   60,
    SWIMLANE_WIDTH:    200,
    SWIMLANE_H_PER_ROW: 35,
    SWIMLANE_COL_STEP: 300,
    SWIMLANE_WRAP_X:   900,
    EP_X_OFFSET:        10,
    EP_Y_START:         45,
    EP_HEIGHT:          30,
    EP_WIDTH:          180,
    DB_ICON_SIZE:       60,
    GLOBE_ICON_SIZE:    20,
};

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function resolveSection(sectionName, parser, visited) {
    if (!visited) visited = new Set();
    if (!sectionName || visited.has(sectionName) || typeof parser.getSection !== 'function') return [];
    visited.add(sectionName);

    const section = parser.getSection(sectionName);
    if (!section) return [];

    const result = [];

    const addEntries = Array.isArray(section['add']) ? section['add'] : [];
    for (const entry of addEntries) {
        const key = entry.$?.key || entry.$?.Key;
        const value = entry.$?.value || entry.$?.Value;
        if (key !== undefined) result.push({ key: String(key), value: String(value ?? ''), section: sectionName });
    }

    const includes = Array.isArray(section['include']) ? section['include'] : [];
    for (const inc of includes) {
        const innerAdds = Array.isArray(inc['add']) ? inc['add'] : [];
        for (const entry of innerAdds) {
            const sectName = entry.$?.section || entry.$?.Section;
            if (sectName) {
                result.push({ isIncludeHeader: true, section: sectName });
                result.push(...resolveSection(sectName, parser, visited));
            }
        }
    }

    return result;
}

function buildNodeProps(node, serviceName, isSource, parser) {
    const connector = getConnectorNode(node);
    const basic = { class: '', address: '', timeout: '' };
    let params = [];

    if (connector) {
        basic.class   = getAttr(connector, 'class');
        basic.address = getAttr(connector, 'address');
        basic.timeout = getAttr(connector, 'timeout');

        const paramsNode = getChildNode(connector, 'params');
        if (paramsNode) {
            const configRef = getAttr(paramsNode, 'config');
            if (configRef) params = resolveSection(configRef, parser);
        }
    }

    return { name: getAttr(node, 'name'), serviceName, isSource, basic, params };
}

// Renders endpoint node cells into a container and updates idRef.value for each allocated ID.
function renderEndpointNodes(parts, endpoints, containerId, idRef) {
    let epY = LAYOUT.EP_Y_START;
    for (const ep of endpoints) {
        ep.id = ++idRef.value;
        parts.push(`<object label="${esc(ep.name)}" id="${ep.id}">`);
        parts.push(`<mxCell style="${DEST_STYLE}" parent="${containerId}" vertex="1" value="${esc(ep.name)}">`);
        parts.push(`<mxGeometry x="${LAYOUT.EP_X_OFFSET}" y="${epY}" width="${LAYOUT.EP_WIDTH}" height="${LAYOUT.EP_HEIGHT}" as="geometry"/>`);
        parts.push('</mxCell></object>');
        epY += LAYOUT.EP_HEIGHT;
    }
    return epY;
}

function getGraphXMLFromConfig(parser) {
    const defaultConnStr = parser.getConnectionStringName() || DEFAULT_CONN_STR;
    const serviceGroups = parser.getServiceGroups();
    const serviceNames = parser.getServices();

    const parts = [
        '<mxGraphModel guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1">',
        '<root><mxCell id="0"/><mxCell id="1" parent="0"/>'
    ];

    const destinations = [];
    const nodeProps = {};
    const serviceIds = {}; // serviceName → cellId string

    // Pass 1: draw service container swimlanes
    let cellId = 1;
    let maxHeight = 0;
    let svcX = LAYOUT.SWIMLANE_X_START, svcY = LAYOUT.SWIMLANE_Y_START;

    for (const svc of serviceNames) {
        cellId++;
        serviceIds[svc.name] = String(cellId);
        const svcNode = parser.getService(svc.name);
        if (!svcNode) continue;

        const destList = getDestinationNodes(svcNode);
        const grpIdx = serviceGroups.indexOf(svc.serviceGroup) % GRP_COLORS.length;
        const style = SRVC_STYLE
            .replace('{fillColor}', GRP_COLORS[grpIdx < 0 ? 0 : grpIdx])
            .replace('{fontColor}', GRP_FONT_COLORS[grpIdx < 0 ? 0 : grpIdx]);

        const height = (destList.length + 2) * LAYOUT.SWIMLANE_H_PER_ROW + 5;
        if (height > maxHeight) maxHeight = height;

        parts.push(`<mxCell id="${cellId}" value="${esc(svc.name)}" style="${esc(style)}" parent="1" vertex="1">`);
        parts.push(`<mxGeometry x="${svcX}" y="${svcY}" width="${LAYOUT.SWIMLANE_WIDTH}" height="${height}" as="geometry"/>`);
        parts.push('</mxCell>');

        if (svcX > LAYOUT.SWIMLANE_WRAP_X) {
            svcX = LAYOUT.SWIMLANE_X_START;
            svcY += maxHeight + LAYOUT.SWIMLANE_H_PER_ROW;
            maxHeight = 0;
        } else {
            svcX += LAYOUT.SWIMLANE_COL_STEP;
        }
    }

    // Pass 2: draw source/destination nodes inside containers
    let destId = cellId;
    cellId = 1;

    for (const svc of serviceNames) {
        cellId++;
        destId++;
        const svcNode = parser.getService(svc.name);
        if (!svcNode) continue;

        let destY = LAYOUT.EP_Y_START;

        // Source node
        const srcNode = getSourceNode(svcNode);
        if (srcNode) {
            const destColl = getDestination(srcNode, destId, true, svc.name, defaultConnStr, parser);
            const dest = destColl[0];
            const srcName = getAttr(srcNode, 'name');
            parts.push(`<object label="${esc(srcName)}" id="${destId}">`);
            parts.push(`<mxCell style="${esc(SRC_STYLE)}" parent="${cellId}" vertex="1" value="${esc(srcName + ' -' + dest.commsType)}">`);
            parts.push(`<mxGeometry x="${LAYOUT.EP_X_OFFSET}" y="${destY}" width="${LAYOUT.EP_WIDTH}" height="${LAYOUT.EP_HEIGHT}" as="geometry"/>`);
            parts.push('</mxCell></object>');
            nodeProps[String(destId)] = buildNodeProps(srcNode, svc.name, true, parser);
            destinations.push(...destColl);
            destId++;
            destY += LAYOUT.EP_HEIGHT;
        }

        // Destination nodes
        for (const destNode of getDestinationNodes(svcNode)) {
            const destColl = getDestination(destNode, destId, false, svc.name, defaultConnStr, parser);
            const dest = destColl[0];
            const dName = getAttr(destNode, 'name');
            parts.push(`<object label="${esc(dName)}" id="${destId}">`);
            parts.push(`<mxCell style="${esc(DEST_STYLE)}" parent="${cellId}" vertex="1" value="${esc(dName + ' -' + dest.commsType)}">`);
            parts.push(`<mxGeometry x="${LAYOUT.EP_X_OFFSET}" y="${destY}" width="${LAYOUT.EP_WIDTH}" height="${LAYOUT.EP_HEIGHT}" as="geometry"/>`);
            parts.push('</mxCell></object>');
            nodeProps[String(destId)] = buildNodeProps(destNode, svc.name, false, parser);
            destinations.push(...destColl);
            destId++;
            destY += LAYOUT.EP_HEIGHT;
        }
    }

    // Pass 3: external destinations (HTTP hosts, DBs, brokers, file system)
    const extDestinations = getExternalDestinations(destinations);
    svcX = LAYOUT.SWIMLANE_X_START;
    svcY += maxHeight + LAYOUT.SWIMLANE_H_PER_ROW;
    maxHeight = 0;

    const idRef = { value: destId };

    for (const extDest of extDestinations) {
        const containerId = ++idRef.value;
        extDest.id = containerId;

        if (extDest.commsType === 'http') {
            const height = (extDest.endPoints.length + 2) * LAYOUT.SWIMLANE_H_PER_ROW + 5;
            if (height > maxHeight) maxHeight = height;

            parts.push(`<mxCell id="${containerId}" value="${esc(extDest.name)}" style="${esc(DEST_CONTAINER_STYLE)}" parent="1" vertex="1">`);
            parts.push(`<mxGeometry x="${svcX}" y="${svcY}" width="${LAYOUT.SWIMLANE_WIDTH}" height="${height}" as="geometry"/>`);
            parts.push('</mxCell>');

            // Globe icon cell
            parts.push(`<mxCell id="${++idRef.value}" value="" style="image;html=1;image=images/internet-world-line-898370.ico;fillColor=#FFFFCC;movable=0;deletable=0;resizable=0;" parent="${containerId}" vertex="1">`);
            parts.push(`<mxGeometry x="${LAYOUT.GLOBE_ICON_SIZE}" width="${LAYOUT.GLOBE_ICON_SIZE}" height="${LAYOUT.GLOBE_ICON_SIZE}" as="geometry"/>`);
            parts.push('</mxCell>');

            renderEndpointNodes(parts, extDest.endPoints, containerId, idRef);
        } else if (extDest.commsType === 'db') {
            parts.push(`<mxCell id="${containerId}" value="${esc(extDest.name)}" style="${esc(DB_DEST_STYLE)}" parent="1" vertex="1">`);
            parts.push(`<mxGeometry x="${svcX}" y="${svcY}" width="${LAYOUT.DB_ICON_SIZE}" height="${LAYOUT.DB_ICON_SIZE}" as="geometry"/>`);
            parts.push('</mxCell>');
            if (maxHeight < LAYOUT.DB_ICON_SIZE) maxHeight = LAYOUT.DB_ICON_SIZE;
        } else if (extDest.commsType === 'file') {
            const height = (extDest.endPoints.length + 2) * LAYOUT.SWIMLANE_H_PER_ROW + 5;
            if (height > maxHeight) maxHeight = height;

            parts.push(`<mxCell id="${containerId}" value="${esc(extDest.name)}" style="${esc(FILESYSTEM_STYLE)}" parent="1" vertex="1">`);
            parts.push(`<mxGeometry x="${svcX}" y="${svcY}" width="${LAYOUT.SWIMLANE_WIDTH}" height="${height}" as="geometry"/>`);
            parts.push('</mxCell>');

            renderEndpointNodes(parts, extDest.endPoints, containerId, idRef);
        } else if (extDest.commsType === 'IBMMQ') {
            const height = (extDest.endPoints.length + 2) * LAYOUT.SWIMLANE_H_PER_ROW + 5;
            if (height > maxHeight) maxHeight = height;

            parts.push(`<mxCell id="${containerId}" value="${esc(extDest.name)}" style="${esc(IBMMQ_BROKER_STYLE)}" parent="1" vertex="1">`);
            parts.push(`<mxGeometry x="${svcX}" y="${svcY}" width="${LAYOUT.SWIMLANE_WIDTH}" height="${height}" as="geometry"/>`);
            parts.push('</mxCell>');

            renderEndpointNodes(parts, extDest.endPoints, containerId, idRef);
        } else if (extDest.commsType === 'amq') {
            const height = (extDest.endPoints.length + 2) * LAYOUT.SWIMLANE_H_PER_ROW + 5;
            if (height > maxHeight) maxHeight = height;

            parts.push(`<mxCell id="${containerId}" value="${esc(extDest.name)}" style="${esc(AMQP_BROKER_STYLE)}" parent="1" vertex="1">`);
            parts.push(`<mxGeometry x="${svcX}" y="${svcY}" width="${LAYOUT.SWIMLANE_WIDTH}" height="${height}" as="geometry"/>`);
            parts.push('</mxCell>');

            renderEndpointNodes(parts, extDest.endPoints, containerId, idRef);
        }

        if (svcX > LAYOUT.SWIMLANE_WRAP_X) {
            svcX = LAYOUT.SWIMLANE_X_START;
            svcY += maxHeight + LAYOUT.SWIMLANE_H_PER_ROW;
            maxHeight = 0;
        } else {
            svcX += LAYOUT.SWIMLANE_COL_STEP;
        }
    }

    destId = idRef.value;

    // Pass 4: connectors
    mapPeerIDs(destinations, extDestinations);
    for (const d of destinations.filter(x => x.peerId !== 0)) {
        const color = CONN_COLORS[d.commsType] || DEFAULT_ARROW_COLOR;
        const connStyle = CONNECTOR_STYLE.replace('{color}', color);
        // Outward flow (service → broker): AMQP sender, IBMMQ sender/rr_req
        const isOutward = (d.commsType === 'amq' && d.mqMode === 'sender') || d.mqFlowDir === 'outward';
        const [src, tgt] = isOutward ? [d.id, d.peerId] : [d.peerId, d.id];
        parts.push(`<object label="" commsType="${esc(d.commsType)}" id="${++destId}">`);
        parts.push(`<mxCell style="${esc(connStyle)}" parent="1" source="${src}" target="${tgt}" edge="1">`);
        parts.push('<mxGeometry width="50" height="50" relative="1" as="geometry">');
        parts.push('<mxPoint x="400" y="300" as="sourcePoint"/>');
        parts.push('<mxPoint x="450" y="250" as="targetPoint"/>');
        parts.push('</mxGeometry></mxCell></object>');
    }

    // Curved dashed arrows for IBMMQ request→response queue pairs within each broker
    for (const ed of extDestinations.filter(x => x.commsType === 'IBMMQ' && x.rrPairs && x.rrPairs.length)) {
        const color = CONN_COLORS['IBMMQ'] || DEFAULT_ARROW_COLOR;
        const curvedStyle = `curved=1;endArrow=classic;startArrow=none;html=1;strokeWidth=1;strokeColor=${color};dashed=1;movable=0;deletable=0;`;
        for (const pair of ed.rrPairs) {
            const reqEp = ed.endPoints.find(ep => ep.address === pair.req);
            const resEp = ed.endPoints.find(ep => ep.address === pair.res);
            if (reqEp && resEp && reqEp.id && resEp.id) {
                parts.push(`<object label="" commsType="IBMMQ" id="${++destId}">`);
                parts.push(`<mxCell style="${esc(curvedStyle)}" parent="1" source="${reqEp.id}" target="${resEp.id}" edge="1">`);
                parts.push('<mxGeometry width="50" height="50" relative="1" as="geometry"/>');
                parts.push('</mxCell></object>');
            }
        }
    }

    parts.push('</root></mxGraphModel>');
    return { graphXML: parts.join(''), nodeProps, serviceIds };
}

function getDestination(node, destId, isSource, serviceName, defaultConnStr, parser) {
    const results = [];
    const connector = getConnectorNode(node);
    if (!connector) return [{ id: destId, name: getAttr(node, 'name'), commsType: 'other', address: '', peerId: 0, isSource, isClient: !isSource, serviceName, externalDestination: false }];

    let adaptor = getAttr(connector, 'class') || '';
    if (adaptor.endsWith('.1') || adaptor.endsWith('.2')) {
        adaptor = adaptor.slice(0, -2);
    }

    let address = getAttr(connector, 'address') || '';
    let commsType = 'other';
    let isClient = !isSource;
    let brokerUrl = '';
    let mqMode = '';
    let brokerHost = '';
    let requestQueue = '';
    let responseQueue = '';
    let mqAdaptorType = '';

    switch (adaptor) {
        case 'Gateway.DBNetDrv':
            commsType = (address === 'NPSSConnectionString' || address === defaultConnStr) ? 'LocalDB' : 'db';
            break;
        case 'Gateway.TCPAdaptor':
        case 'Gateway.TCPClient': {
            commsType = 'tcp';
            const listenerAttr = getAttr(connector, 'listener');
            if (listenerAttr === 'y') isClient = false;
            break;
        }
        case 'Gateway.TCPListener':
            commsType = 'tcp';
            isClient = false;
            break;
        case 'Gateway.HTTPAdaptor':
            commsType = 'http';
            break;
        case 'Gateway.WebSocketAdaptor':
            commsType = 'WSO';
            break;
        case 'Gateway.WebAPIAdaptor':
            commsType = 'api';
            break;
        case 'Gateway.AMQPClient': {
            commsType = 'amq';
            isClient = true;
            const amqpParams = getAdaptorParams(connector, parser);
            brokerUrl = amqpParams.url || '';
            mqMode    = amqpParams.mq_mode || 'receiver';
            if (amqpParams.address) address = amqpParams.address; // queue name from config section
            break;
        }
        case 'Gateway.ICEAdaptor':
            commsType = 'ICE';
            break;
        case 'Gateway.FileAdaptor': {
            commsType = 'file';
            const fileParams = getAdaptorParams(connector, parser);
            const folderPath = isSource
                ? (fileParams.source_folder      || '')
                : (fileParams.destination_folder || '');
            if (folderPath) address = folderPath;
            break;
        }
        case 'Gateway.MQSender': {
            commsType = 'IBMMQ';
            const mqpS = getAdaptorParams(connector, parser);
            brokerHost    = parseMQBrokerHost(mqpS.connection_name);
            requestQueue  = mqpS.request_queue || '';
            mqAdaptorType = 'sender';
            break;
        }
        case 'Gateway.MQAdaptorEx':
        case 'Gateway.IBMMQAdaptor':
        case 'Gateway.MQAdaptor': {
            commsType = 'IBMMQ';
            const mqpRR = getAdaptorParams(connector, parser);
            brokerHost    = parseMQBrokerHost(mqpRR.connection_name);
            requestQueue  = mqpRR.request_queue  || '';
            responseQueue = mqpRR.response_queue || '';
            mqAdaptorType = 'rr';
            break;
        }
        case 'Gateway.MQReceiver':
        case 'Gateway.MQListener': {
            commsType = 'IBMMQ';
            isClient = false;
            const mqpR = getAdaptorParams(connector, parser);
            brokerHost    = parseMQBrokerHost(mqpR.connection_name);
            requestQueue  = mqpR.request_queue || '';
            mqAdaptorType = 'receiver';
            break;
        }
    }

    const dest = { id: destId, name: getAttr(node, 'name'), commsType, address, peerId: 0, isSource, isClient, serviceName, externalDestination: false, brokerUrl, mqMode, brokerHost, requestQueue, responseQueue, mqAdaptorType };
    results.push(dest);

    // WSO creates a secondary TCP destination from params/config
    if (commsType === 'WSO') {
        const paramsNode = getChildNode(connector, 'params');
        const scAddress = paramsNode ? getAttr(paramsNode, 'sc_address') || getAttr(paramsNode, 'config') : '';
        if (scAddress) {
            results.push({ ...dest, commsType: 'tcp', address: scAddress });
        }
    }

    // IBMMQ request/response: emit two entries — one for each direction
    if (commsType === 'IBMMQ' && mqAdaptorType === 'rr' && requestQueue && responseQueue) {
        dest.mqAdaptorType = 'rr_req';
        results.push({ ...dest, mqAdaptorType: 'rr_res' });
    }

    return results;
}

function getExternalDestinations(destinations) {
    const extDest = [];

    // HTTP: group by hostname
    const httpHosts = [...new Set(
        destinations.filter(d => d.commsType === 'http').map(d => {
            try { return new URL(d.address).hostname; } catch { return d.address; }
        })
    )];

    for (const host of httpHosts) {
        const matching = destinations.filter(d => {
            if (d.commsType !== 'http') return false;
            try { return new URL(d.address).hostname === host; } catch { return d.address === host; }
        });
        if (!matching.length) continue;
        const ext = { ...matching[0], id: 0, name: host, address: host, endPoints: [], externalDestination: true };
        const uniqueAddresses = [...new Set(matching.map(d => d.address))];
        for (const addr of uniqueAddresses) {
            let pathname = addr;
            try { pathname = new URL(addr).pathname; } catch {}
            ext.endPoints.push({ ...matching[0], id: 0, name: pathname, address: addr, externalDestination: true });
        }
        extDest.push(ext);
    }

    // DB: group by connection string name
    const dbAddresses = [...new Set(destinations.filter(d => d.commsType === 'db').map(d => d.address))];
    for (const addr of dbAddresses) {
        const matching = destinations.filter(d => d.commsType === 'db' && d.address === addr);
        if (!matching.length) continue;
        extDest.push({ ...matching[0], id: 0, name: addr, address: addr, endPoints: [], externalDestination: true });
    }

    // IBMMQ: group by broker host (parsed from connection_name)
    const ibmmqHosts = [...new Set(
        destinations.filter(d => d.commsType === 'IBMMQ' && d.brokerHost).map(d => d.brokerHost)
    )];
    for (const host of ibmmqHosts) {
        const matching = destinations.filter(d => d.commsType === 'IBMMQ' && d.brokerHost === host);
        const queueSet = new Map(); // queue name → order of first appearance
        const rrPairs  = [];
        for (const d of matching) {
            if (d.requestQueue)  queueSet.set(d.requestQueue,  queueSet.size);
            if (d.responseQueue) queueSet.set(d.responseQueue, queueSet.size);
            if ((d.mqAdaptorType === 'rr' || d.mqAdaptorType === 'rr_req') && d.requestQueue && d.responseQueue) {
                if (!rrPairs.some(p => p.req === d.requestQueue && p.res === d.responseQueue)) {
                    rrPairs.push({ req: d.requestQueue, res: d.responseQueue });
                }
            }
        }
        const ext = { ...matching[0], id: 0, name: `IBMMQ Broker - ${host}`, address: host, endPoints: [], rrPairs, externalDestination: true };
        for (const [queue] of queueSet) {
            ext.endPoints.push({ ...matching[0], id: 0, name: queue, address: queue, externalDestination: true });
        }
        extDest.push(ext);
    }

    // File: all folder paths under a single "File System" container
    const fileDests = destinations.filter(d => d.commsType === 'file' && d.address);
    if (fileDests.length) {
        const uniquePaths = [...new Set(fileDests.map(d => d.address))];
        const ext = { ...fileDests[0], id: 0, name: 'File System', address: 'filesystem', endPoints: [], externalDestination: true };
        for (const p of uniquePaths) {
            ext.endPoints.push({ ...fileDests[0], id: 0, name: p, address: p, externalDestination: true });
        }
        extDest.push(ext);
    }

    // AMQP: group by broker hostname
    const amqpHosts = [...new Set(
        destinations.filter(d => d.commsType === 'amq' && d.brokerUrl).map(d => {
            try { return new URL(d.brokerUrl).hostname; } catch { return d.brokerUrl; }
        })
    )];
    for (const host of amqpHosts) {
        const matching = destinations.filter(d => {
            if (d.commsType !== 'amq' || !d.brokerUrl) return false;
            try { return new URL(d.brokerUrl).hostname === host; } catch { return d.brokerUrl === host; }
        });
        if (!matching.length) continue;
        const ext = { ...matching[0], id: 0, name: `AMQ Broker - ${host}`, address: host, endPoints: [], externalDestination: true };
        const uniqueQueues = [...new Set(matching.map(d => d.address))];
        for (const queue of uniqueQueues) {
            ext.endPoints.push({ ...matching[0], id: 0, name: queue, address: queue, externalDestination: true });
        }
        extDest.push(ext);
    }

    return extDest;
}

// Matches internal client/server destination pairs by commsType and address.
function matchInternalPeers(destinations, commsType) {
    for (const d of destinations.filter(x => x.isClient && x.commsType === commsType)) {
        const peer = destinations.find(x => x.commsType === commsType && !x.isClient && x.address === d.address);
        if (peer) { d.peerId = peer.id; d.externalDestination = false; }
    }
}

function mapPeerIDs(destinations, extDestinations) {
    // P2P: client → server matched by commsType + address
    for (const t of ['tcp', 'ICE', 'api']) matchInternalPeers(destinations, t);

    // HTTP client → external HTTP endpoint
    for (const d of destinations.filter(x => x.isClient && x.commsType === 'http')) {
        const extHost = extDestinations.find(ed => ed.commsType === 'http' && ed.endPoints.some(ep => ep.address === d.address));
        if (extHost) {
            const ep = extHost.endPoints.find(ep => ep.address === d.address);
            if (ep) { d.peerId = ep.id; d.externalDestination = true; }
        }
    }

    // DB client → external DB
    for (const d of destinations.filter(x => x.isClient && x.commsType === 'db')) {
        const extDB = extDestinations.find(ed => ed.commsType === 'db' && ed.address === d.address);
        if (extDB) { d.peerId = extDB.id; d.externalDestination = true; }
    }

    // IBMMQ → external broker endpoint
    for (const d of destinations.filter(x => x.commsType === 'IBMMQ' && x.brokerHost)) {
        const extBroker = extDestinations.find(ed => ed.commsType === 'IBMMQ' && ed.address === d.brokerHost);
        if (!extBroker) continue;
        let queueName = '';
        let flowDir   = 'inward';
        if      (d.mqAdaptorType === 'sender')   { queueName = d.requestQueue;  flowDir = 'outward'; }
        else if (d.mqAdaptorType === 'receiver')  { queueName = d.requestQueue;  flowDir = 'inward';  }
        else if (d.mqAdaptorType === 'rr_req')    { queueName = d.requestQueue;  flowDir = 'outward'; }
        else if (d.mqAdaptorType === 'rr_res')    { queueName = d.responseQueue; flowDir = 'inward';  }
        if (queueName) {
            const ep = extBroker.endPoints.find(ep => ep.address === queueName);
            if (ep) { d.peerId = ep.id; d.mqFlowDir = flowDir; d.externalDestination = true; }
        }
    }

    // AMQP → external broker endpoint (matched by hostname + queue name)
    for (const d of destinations.filter(x => x.commsType === 'amq' && x.brokerUrl)) {
        let brokerHost = d.brokerUrl;
        try { brokerHost = new URL(d.brokerUrl).hostname; } catch {}
        const extBroker = extDestinations.find(ed => ed.commsType === 'amq' && ed.address === brokerHost);
        if (extBroker) {
            const ep = extBroker.endPoints.find(ep => ep.address === d.address);
            if (ep) { d.peerId = ep.id; d.externalDestination = true; }
        }
    }

    // File → external File System endpoint
    const extFS = extDestinations.find(ed => ed.commsType === 'file');
    if (extFS) {
        for (const d of destinations.filter(x => x.commsType === 'file' && x.address)) {
            const ep = extFS.endPoints.find(ep => ep.address === d.address);
            if (ep) {
                d.peerId = ep.id;
                d.mqFlowDir = d.isSource ? 'inward' : 'outward';
                d.externalDestination = true;
            }
        }
    }
}

function parseMQBrokerHost(connectionName) {
    if (!connectionName) return 'localhost';
    const paren = connectionName.indexOf('(');
    return (paren > 0 ? connectionName.slice(0, paren) : connectionName).trim();
}

function getAdaptorParams(connector, parser) {
    const paramsNode = getChildNode(connector, 'params');
    if (!paramsNode) return {};
    const configRef = getAttr(paramsNode, 'config');
    if (!configRef || typeof parser.getSection !== 'function') return {};
    const entries = resolveSection(configRef, parser);
    const map = {};
    for (const e of entries) {
        if (!e.isIncludeHeader) map[e.key] = e.value;
    }
    return map;
}

// xml2js node helpers
function getAttr(node, attrName) {
    if (!node) return '';
    const attrs = node.$ || node['$'] || {};
    return attrs[attrName] || attrs[attrName.toLowerCase()] || '';
}

function getChildNode(node, childName) {
    if (!node) return null;
    const children = node[childName] || node[childName.toLowerCase()];
    return Array.isArray(children) ? children[0] : children || null;
}

function getConnectorNode(node) {
    return getChildNode(node, 'connector') || getChildNode(node, 'Connector');
}

function getSourceNode(svcNode) {
    return getChildNode(svcNode, 'Source') || getChildNode(svcNode, 'source');
}

function getDestinationNodes(svcNode) {
    const list = svcNode['Destination'] || svcNode['destination'] || [];
    return Array.isArray(list) ? list : [list];
}

module.exports = { getGraphXMLFromConfig };

const fs   = require('fs');
const path = require('path');

let _SQL = null;
async function getSQL() {
    if (!_SQL) _SQL = await require('sql.js')();
    return _SQL;
}

// Extract routing meta from the service's XML element.
function getServiceRoutingMeta(parser, serviceName) {
    const el = parser.getService(serviceName);
    if (!el) return null;

    const configDbAttr = el?.$?.config_db_name || el?.$?.config_db || '';
    const dbNames = configDbAttr.split(',').map(s => s.trim()).filter(Boolean);

    const source = el?.Source?.[0] || el?.source?.[0];
    const format = source?.format?.[0];
    const srcFormatName = format?.$?.type || '';
    const sourceName    = source?.$?.name  || '';

    return dbNames.length && srcFormatName ? { dbNames, srcFormatName, sourceName } : null;
}

// Build a map of destination name → FormatName from parser XML.
function getDestFormatMap(parser, serviceName) {
    const el = parser.getService(serviceName);
    if (!el) return {};
    const map  = {};
    const dests = [].concat(el?.Destination || el?.destination || []);
    for (const d of dests) {
        const name = d?.$?.name;
        const fmt  = d?.format?.[0]?.$?.type;
        if (name && fmt) map[name] = fmt;
    }
    return map;
}

// Query the Condition table for a single condition.
function queryCondition(db, formatName, conditionId) {
    if (!formatName || !conditionId) return null;
    try {
        const stmt = db.prepare(
            'SELECT ConditionID, Name, Expression, Description FROM Condition WHERE FormatName = ? AND ConditionID = ?'
        );
        stmt.bind([formatName, conditionId]);
        const ok  = stmt.step();
        const row = ok ? stmt.getAsObject() : null;
        stmt.free();
        return row;
    } catch { return null; }
}

// Query the Messages table for a single message type in a single DB.
function queryMessageName(db, formatName, msgType) {
    if (!formatName || !msgType) return null;
    try {
        const stmt = db.prepare(
            'SELECT MessageName, Response, Description FROM Messages WHERE FormatName = ? AND MessageType = ?'
        );
        stmt.bind([formatName, msgType]);
        const ok  = stmt.step();
        const row = ok ? stmt.getAsObject() : null;
        stmt.free();
        if (!row) return null;
        return {
            messageName: row.MessageName || msgType,
            isResponse:  row.Response === 1 || row.Response === '1' || row.Response === true,
            description: row.Description || ''
        };
    } catch { return null; }
}

// Search across all open DBs for a message name (FormatName may be in any DB).
function queryMessageNameAny(dbs, formatName, msgType) {
    for (const db of dbs) {
        const result = queryMessageName(db, formatName, msgType);
        if (result) return result;
    }
    return null;
}

// Query MessageFields joined with Fields for a single (FormatName, MessageType) across all DBs.
function queryMessageFields(dbs, formatName, messageType) {
    if (!formatName || !messageType) return [];
    const sql = `
        SELECT Fields.fieldName AS Name, MessageFields.variableName AS VariableName,
               MessageFields."default" AS "Default", Fields.lengthtype AS LengthType,
               Fields.description AS Description
        FROM MessageFields
        INNER JOIN Fields ON MessageFields.FormatName = Fields.FormatName
                          AND MessageFields.fieldIndex = Fields."index"
        WHERE MessageFields.FormatName = ? AND MessageFields.MessageType = ?
        ORDER BY MessageFields.fieldIndex`;
    for (const db of dbs) {
        try {
            const stmt = db.prepare(sql);
            stmt.bind([formatName, messageType]);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free();
            if (rows.length) return rows;
        } catch { /* try next db */ }
    }
    return [];
}

// Query the Formats table for a single FormatName across all DBs.
// behavior column is optional — tries with it first, falls back without.
function queryFormat(dbs, formatName) {
    if (!formatName) return null;
    for (const db of dbs) {
        try {
            let row = null;
            try {
                const stmt = db.prepare(
                    'SELECT FormatName, parserType, trans_to, trans_from, behavior FROM Formats WHERE FormatName = ?'
                );
                stmt.bind([formatName]);
                row = stmt.step() ? stmt.getAsObject() : null;
                stmt.free();
            } catch {
                // behavior column absent — retry without it
                try {
                    const stmt = db.prepare(
                        'SELECT FormatName, parserType, trans_to, trans_from FROM Formats WHERE FormatName = ?'
                    );
                    stmt.bind([formatName]);
                    row = stmt.step() ? stmt.getAsObject() : null;
                    stmt.free();
                } catch { /* try next db */ }
            }
            if (row) return row;
        } catch { /* try next db */ }
    }
    return null;
}

// Try each config DB until one with the matching FormatName is found.
async function openRoutingDB(dbNames, basePath, projectPath, srcFormatName) {
    const SQL = await getSQL();
    for (const dbRel of dbNames) {
        const dbPath = path.join(basePath, projectPath, dbRel);
        if (!fs.existsSync(dbPath)) continue;
        try {
            const buf = fs.readFileSync(dbPath);
            const db  = new SQL.Database(buf);
            const stmt = db.prepare('SELECT COUNT(*) AS cnt FROM Routing WHERE FormatName = ?');
            stmt.bind([srcFormatName]);
            const found = stmt.step() && stmt.getAsObject().cnt > 0;
            stmt.free();
            if (found) return { db, srcFormatName };
            db.close();
        } catch { /* try next */ }
    }
    return null;
}

// Open every available DB from the list (for cross-DB message lookups).
async function openAllDBs(dbNames, basePath, projectPath) {
    const SQL = await getSQL();
    const dbs = [];
    for (const dbRel of dbNames) {
        const dbPath = path.join(basePath, projectPath, dbRel);
        if (!fs.existsSync(dbPath)) continue;
        try {
            const buf = fs.readFileSync(dbPath);
            dbs.push(new SQL.Database(buf));
        } catch { /* skip unavailable */ }
    }
    return dbs;
}

// Find the DB (from an already-opened array) that holds routing records for srcFormatName.
function findRoutingDB(dbs, srcFormatName) {
    for (const db of dbs) {
        try {
            const stmt = db.prepare('SELECT COUNT(*) AS cnt FROM Routing WHERE FormatName = ?');
            stmt.bind([srcFormatName]);
            const found = stmt.step() && stmt.getAsObject().cnt > 0;
            stmt.free();
            if (found) return db;
        } catch { /* try next */ }
    }
    return null;
}

async function queryRoutingTypes(parser, basePath, serviceName) {
    const meta = getServiceRoutingMeta(parser, serviceName);
    if (!meta) return { srcFormatName: '', sourceName: '', types: [] };

    const projectPath = parser.getProjectPath() || '';
    const opened = await openRoutingDB(meta.dbNames, basePath, projectPath, meta.srcFormatName);
    if (!opened) return { srcFormatName: meta.srcFormatName, sourceName: meta.sourceName, types: [] };

    const { db, srcFormatName } = opened;
    try {
        const stmt = db.prepare(
            'SELECT DISTINCT ReceiveMsgType FROM Routing WHERE FormatName = ? ORDER BY ReceiveMsgType'
        );
        stmt.bind([srcFormatName]);
        const types = [];
        while (stmt.step()) types.push(stmt.getAsObject().ReceiveMsgType);
        stmt.free();
        return { srcFormatName, sourceName: meta.sourceName, types };
    } finally {
        db.close();
    }
}

async function queryRoutingRecords(parser, basePath, serviceName, rcvMsgType) {
    const meta = getServiceRoutingMeta(parser, serviceName);
    if (!meta) return { srcFormatName: '', sourceName: '', rcvMsgName: '', rcvMsgIsResp: false, rcvMsgDesc: '', records: [] };

    const projectPath  = parser.getProjectPath() || '';
    const allDbs = await openAllDBs(meta.dbNames, basePath, projectPath);
    if (!allDbs.length) return { srcFormatName: meta.srcFormatName, sourceName: meta.sourceName, rcvMsgName: '', rcvMsgIsResp: false, rcvMsgDesc: '', records: [] };

    const db = findRoutingDB(allDbs, meta.srcFormatName);
    if (!db) {
        allDbs.forEach(d => d.close());
        return { srcFormatName: meta.srcFormatName, sourceName: meta.sourceName, rcvMsgName: '', rcvMsgIsResp: false, rcvMsgDesc: '', records: [] };
    }

    const srcFormatName = meta.srcFormatName;
    const destFormatMap = getDestFormatMap(parser, serviceName);
    const rcvMsg = queryMessageNameAny(allDbs, srcFormatName, rcvMsgType);

    try {
        // Detect optional IsParallel column
        const colStmt = db.prepare('PRAGMA table_info(Routing)');
        const cols = [];
        while (colStmt.step()) cols.push(colStmt.getAsObject().name);
        colStmt.free();
        const hasPar = cols.includes('IsParallel');

        const select = `SELECT FormatName, ReceiveMsgType, SeqNbr, Action, FilterID,
            OutputMsgType, ResponseMsgType, conditionID, Destination${hasPar ? ', IsParallel' : ''}
            FROM Routing WHERE FormatName = ? AND ReceiveMsgType = ? ORDER BY SeqNbr`;

        const stmt = db.prepare(select);
        stmt.bind([srcFormatName, rcvMsgType]);
        const records = [];

        while (stmt.step()) {
            const rec = stmt.getAsObject();
            const act = (rec.Action || '').toLowerCase();

            // Determine FormatName for the output message
            let outFormatName = '';
            if (act === 'translate') {
                outFormatName = rec.Destination || '';   // Destination IS FormatName for translate
            } else if (act === 'transact') {
                outFormatName = destFormatMap[rec.Destination] || '';
            } else if (act === 'reply') {
                outFormatName = srcFormatName;           // reply sends back to the source format
            }

            // Resolve output message name — search across all DBs
            const outMsg = queryMessageNameAny(allDbs, outFormatName, rec.OutputMsgType);
            rec.OutputMsgName    = outMsg?.messageName || '';
            rec.OutputMsgIsResp  = outMsg?.isResponse  ?? false;
            rec.OutputMsgDesc    = outMsg?.description  || '';
            rec.OutputFormatName = outFormatName;

            // Resolve response message name — search across all DBs
            if ((act === 'transact' || act === 'translate') && rec.ResponseMsgType) {
                const resMsg = queryMessageNameAny(allDbs, outFormatName, rec.ResponseMsgType)
                            || queryMessageNameAny(allDbs, srcFormatName, rec.ResponseMsgType);
                rec.ResponseMsgName   = resMsg?.messageName || '';
                rec.ResponseMsgIsResp = resMsg?.isResponse  ?? false;
                rec.ResponseMsgDesc   = resMsg?.description || '';
            }

            // Resolve condition details (conditions are tied to srcFormatName in the routing DB)
            if ((rec.conditionID || 0) > 0) {
                const cond = queryCondition(db, srcFormatName, rec.conditionID);
                if (cond) {
                    rec.ConditionName        = cond.Name        || '';
                    rec.ConditionExpression  = cond.Expression  || '';
                    rec.ConditionDescription = cond.Description || '';
                }
            }

            records.push(rec);
        }
        stmt.free();

        // Collect unique FormatNames and resolve Formats table entries across all DBs
        const formatNames = new Set([srcFormatName]);
        for (const rec of records) {
            if (rec.OutputFormatName) formatNames.add(rec.OutputFormatName);
        }
        const formats = {};
        for (const fn of formatNames) {
            const fmt = queryFormat(allDbs, fn);
            if (fmt) formats[fn] = fmt;
        }

        // Collect unique (FormatName, MessageType) pairs and resolve field lists
        const msgFieldKeys = new Set();
        if (rcvMsgType) msgFieldKeys.add(`${srcFormatName}|${rcvMsgType}`);
        for (const rec of records) {
            if (rec.OutputFormatName && rec.OutputMsgType)   msgFieldKeys.add(`${rec.OutputFormatName}|${rec.OutputMsgType}`);
            if (rec.OutputFormatName && rec.ResponseMsgType) msgFieldKeys.add(`${rec.OutputFormatName}|${rec.ResponseMsgType}`);
        }
        const messageFields = {};
        for (const key of msgFieldKeys) {
            const bar = key.indexOf('|');
            const fields = queryMessageFields(allDbs, key.slice(0, bar), key.slice(bar + 1));
            if (fields.length) messageFields[key] = fields;
        }

        return {
            srcFormatName,
            sourceName:   meta.sourceName,
            rcvMsgName:   rcvMsg?.messageName || '',
            rcvMsgIsResp: rcvMsg?.isResponse  ?? false,
            rcvMsgDesc:   rcvMsg?.description  || '',
            records,
            formats,
            messageFields,
        };
    } finally {
        allDbs.forEach(d => d.close());
    }
}

module.exports = { queryRoutingTypes, queryRoutingRecords };

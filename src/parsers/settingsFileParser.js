const fs = require('fs');
const xml2js = require('xml2js');

// Recursively walk a xml2js-parsed object and apply replaceFn to every string value.
// Attributes are stored under the '$' key; text content of mixed nodes under '_'.
function substituteInDoc(obj, replaceFn) {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            if (typeof obj[i] === 'string') {
                obj[i] = replaceFn(obj[i]);
            } else {
                substituteInDoc(obj[i], replaceFn);
            }
        }
    } else if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            if (key === '$') {
                for (const ak of Object.keys(obj.$)) {
                    if (typeof obj.$[ak] === 'string') {
                        obj.$[ak] = replaceFn(obj.$[ak]);
                    }
                }
            } else if (typeof obj[key] === 'string') {
                obj[key] = replaceFn(obj[key]);
            } else {
                substituteInDoc(obj[key], replaceFn);
            }
        }
    }
}

// Flatten a nested JSON object into a lowercase-keyed map of string values.
// Both full dot-paths ('ServiceSettings.ConnectionStringName') and bare leaf
// keys ('ConnectionStringName') are registered so either form works in {cfg:}.
function flattenJson(obj, prefix, out) {
    if (!out) out = {};
    if (obj === null || obj === undefined) return out;
    if (typeof obj !== 'object' || Array.isArray(obj)) {
        if (prefix) out[prefix.toLowerCase()] = obj != null ? String(obj) : '';
        return out;
    }
    for (const key of Object.keys(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const val  = obj[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            flattenJson(val, path, out);
        } else if (!Array.isArray(val)) {
            out[path.toLowerCase()] = val != null ? String(val) : '';
            // Also register by bare leaf key if not already present
            const leafKey = key.toLowerCase();
            if (!(leafKey in out)) out[leafKey] = val != null ? String(val) : '';
        }
    }
    return out;
}

// Extract the variable name from a '{env:VARNAME}' or '{cfg:VARNAME}' placeholder.
// Mirrors the C# logic: IndexOf('}', 4) > 5 ensures the name is at least 1 char.
function extractPlaceholderName(value) {
    const closeIdx = value.indexOf('}', 4);
    if (closeIdx <= 5) return null;
    return value.substring(5, closeIdx);
}


class SettingsFileParser {
    constructor() {
        this._json = null;
        this._xmlDoc = null;
    }

    async open(jsonPath, xmlPath) {
        this._json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const xmlText = fs.readFileSync(xmlPath, 'utf8');
        const parser = new xml2js.Parser({ explicitArray: true, mergeAttrs: false });
        this._xmlDoc = await parser.parseStringPromise(xmlText);
        this._applySubstitutions();
    }

    _applySubstitutions() {
        const rootKey   = Object.keys(this._xmlDoc)[0];
        const rootAttrs = this._xmlDoc[rootKey]?.$ || {};

        // Environment variable substitution — attribute name preserves original typo
        let envPrefix = rootAttrs['enviromnentPrefix'] || '';
        if (envPrefix.length > 0) {
            if (!envPrefix.endsWith('_')) envPrefix += '_';
            this._substituteEnvVars(envPrefix);
        }

        // JSON config substitution
        if ((rootAttrs['mergeConfiguration'] || '') === '1') {
            this._substituteConfigVars();
        }
    }

    _substituteEnvVars(prefix) {
        const prefixLower = prefix.toLowerCase();
        const envData = {};
        for (const [key, val] of Object.entries(process.env)) {
            if (key.toLowerCase().startsWith(prefixLower)) {
                const shortKey = key.substring(prefix.length).toLowerCase();
                let value = val ?? '';
                if (value === 'null' || value === 'undefined') value = '';
                envData[shortKey] = value;
            }
        }

        substituteInDoc(this._xmlDoc, (value) => {
            if (!value.startsWith('{env:')) return value;
            const varName = extractPlaceholderName(value);
            if (varName === null) return value;
            const resolved = envData[varName.toLowerCase()];
            return resolved !== undefined ? resolved : value;
        });
    }

    _substituteConfigVars() {
        const cfgData = flattenJson(this._json);

        substituteInDoc(this._xmlDoc, (value) => {
            if (!value.startsWith('{cfg:')) return value;
            const varName = extractPlaceholderName(value);
            if (varName === null) return value;
            // {cfg:} keys use ':' as the section separator (ASP.NET Core convention);
            // flattenJson builds keys with '.' separators — normalise before lookup.
            const normalised = varName.toLowerCase().replace(/:/g, '.');
            const resolved = cfgData[normalised] ?? cfgData[varName.toLowerCase()];
            return (resolved != null && resolved !== '') ? resolved : value;
        });
    }

    getServiceGroups() {
        const services = this._json?.ServiceList?.Services || [];
        const groups = new Set(
            services
                .filter(s => (s.Type || '').startsWith('UnityServices.DynamicAdaptorService'))
                .map(s => s.ServiceGroup || 'Default')
        );
        return [...groups];
    }

    getServices() {
        const services = this._json?.ServiceList?.Services || [];
        const seen = new Set();
        return services
            .filter(s => (s.Type || '').startsWith('UnityServices.DynamicAdaptorService'))
            .map(s => ({ name: s.Name, serviceGroup: s.ServiceGroup || 'Default' }))
            .filter(s => {
                if (seen.has(s.name)) return false;
                seen.add(s.name);
                return s.name;
            });
    }

    getService(name) {
        const root = this._xmlDoc;
        if (!root) return null;
        const rootKey = Object.keys(root)[0];
        const rootEl  = root[rootKey];
        return rootEl?.[name]?.[0] || rootEl?.[name.toLowerCase()]?.[0] || null;
    }

    getConnectionStringName() {
        return this._json?.ServiceSettings?.ConnectionStringName || null;
    }

    getProjectPath() {
        return this._json?.ServiceSettings?.ProjectPath || null;
    }

    getSection(name) {
        if (!this._xmlDoc) return null;
        const rootKey = Object.keys(this._xmlDoc)[0];
        const rootEl  = this._xmlDoc[rootKey];
        return rootEl?.[name]?.[0] || rootEl?.[name.toLowerCase()]?.[0] || null;
    }
}

module.exports = SettingsFileParser;

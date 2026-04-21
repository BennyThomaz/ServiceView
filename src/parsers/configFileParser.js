const fs = require('fs');
const xml2js = require('xml2js');

class ConfigFileParser {
    constructor() {
        this._doc = null;
    }

    async open(filePath) {
        const xml = fs.readFileSync(filePath, 'utf8');
        const parser = new xml2js.Parser({ explicitArray: true, mergeAttrs: false });
        this._doc = await parser.parseStringPromise(xml);
    }

    getServiceGroups() {
        const groups = new Set();
        const services = this._getServiceElements();
        for (const s of services) {
            const grp = s.$?.serviceGroup || s.$?.ServiceGroup || '';
            if (grp) groups.add(grp);
        }
        return [...groups];
    }

    getServices() {
        const services = this._getServiceElements();
        const seen = new Set();
        return services
            .filter(s => {
                const value = s.$?.value || s.$?.Value || '';
                return value.startsWith('UnityServices.DynamicAdaptorService');
            })
            .map(s => ({
                name: s.$?.key || s.$?.Key || '',
                serviceGroup: s.$?.serviceGroup || s.$?.ServiceGroup || 'Default'
            }))
            .filter(s => {
                if (seen.has(s.name)) return false;
                seen.add(s.name);
                return s.name;
            });
    }

    getService(name) {
        const root = this._doc?.configuration;
        if (!root) return null;
        // The service config section may be at root level with various capitalizations
        const section = root[name]?.[0] || root[name.toLowerCase()]?.[0];
        return section || null;
    }

    getConnectionStringName() {
        return 'WPSConnectionString';
    }

    getSection(name) {
        const root = this._doc?.configuration;
        if (!root) return null;
        return root[name]?.[0] || root[name.toLowerCase()]?.[0] || null;
    }

    _getServiceElements() {
        const root = this._doc?.configuration;
        if (!root) return [];
        // ServiceList section — try common formats
        const sl = root['ServiceList']?.[0] || root['servicelist']?.[0];
        if (!sl) return [];
        return sl['add'] || sl['service'] || sl['Service'] || [];
    }
}

module.exports = ConfigFileParser;

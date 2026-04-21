const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { getGraphXMLFromConfig } = require('./src/parsers/serviceConfiguration');
const ConfigFileParser = require('./src/parsers/configFileParser');
const SettingsFileParser = require('./src/parsers/settingsFileParser');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Load .config XML file
app.post('/api/load/config', upload.single('configFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
        const parser = new ConfigFileParser();
        await parser.open(req.file.path);
        const { graphXML, nodeProps, serviceIds } = getGraphXMLFromConfig(parser);
        const services = parser.getServices();
        res.json({ graphXML, nodeProps, serviceIds, services, fileName: req.file.originalname });
    } catch (err) {
        console.error('[/api/load/config]', err);
        res.status(500).json({ error: err.message });
    } finally {
        fs.unlink(req.file.path, () => {});
    }
});

// Load JSON settings + DynamicAdaptor.xml
app.post('/api/load/json', upload.fields([
    { name: 'jsonFile', maxCount: 1 },
    { name: 'xmlFile', maxCount: 1 }
]), async (req, res) => {
    const jsonFile = req.files?.jsonFile?.[0];
    const xmlFile = req.files?.xmlFile?.[0];
    if (!jsonFile || !xmlFile) {
        return res.status(400).json({ error: 'Both JSON settings file and DynamicAdaptor.xml are required' });
    }
    try {
        const parser = new SettingsFileParser();
        await parser.open(jsonFile.path, xmlFile.path);
        const { graphXML, nodeProps, serviceIds } = getGraphXMLFromConfig(parser);
        const services = parser.getServices();

        const tabName = parser.getProjectPath() || jsonFile.originalname;
        res.json({ graphXML, nodeProps, serviceIds, services, fileName: tabName });
    } catch (err) {
        console.error('[/api/load/json]', err);
        res.status(500).json({ error: err.message });
    } finally {
        fs.unlink(jsonFile.path, () => {});
        fs.unlink(xmlFile.path, () => {});
    }
});

// Load a previously saved diagram XML
app.post('/api/load/diagram', upload.single('diagramFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
        const graphXML = fs.readFileSync(req.file.path, 'utf8');
        res.json({ graphXML, services: [], fileName: req.file.originalname });
    } catch (err) {
        console.error('[/api/load/diagram]', err);
        res.status(500).json({ error: err.message });
    } finally {
        fs.unlink(req.file.path, () => {});
    }
});

app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`DynamicAdaptor Explorer running at ${url}`);
    const opener = process.platform === 'win32' ? `start "" "${url}"`
                 : process.platform === 'darwin' ? `open "${url}"`
                 : `xdg-open "${url}"`;
    exec(opener);
});

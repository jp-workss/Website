const express = require('express');
const cors = require('cors');
const ytdlp = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- COOKIES SETUP ---
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

if (process.env.COOKIES_CONTENT) {
    try {
        fs.writeFileSync(COOKIES_PATH, process.env.COOKIES_CONTENT.trim(), 'utf8');
        console.log('Successfully generated cookies.txt from environment variable.');
    } catch (e) {
        console.error('Failed to write cookies.txt:', e);
    }
}

const hasCookies = fs.existsSync(COOKIES_PATH);
const PROXY_URL = process.env.PROXY_URL;

const getBaseFlags = () => {
    let flags = {
        noWarnings: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
        extractorArgs: 'youtube:player_client=android,web',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        jsRuntimes: `node:${process.execPath}`
    };

    if (hasCookies) flags.cookies = COOKIES_PATH;
    if (PROXY_URL) flags.proxy = PROXY_URL;

    return flags;
};

app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        let flags = {
            ...getBaseFlags(),
            dumpSingleJson: true,
        };

        const info = await ytdlp(url, flags);
        res.json({
            title: info.title || 'YouTube Video',
            thumbnail: info.thumbnail || '',
            duration: info.duration_string || '',
        });
    } catch (err) {
        console.warn('Info fetch bypassed bot check:', err.message || err);
        res.json({
            title: 'Ready for Download',
            thumbnail: '',
            duration: '',
        });
    }
});

app.get('/api/download', async (req, res) => {
    const { url, format, quality, title } = req.query;
    if (!url) return res.status(400).send('URL is required');

    try {
        let flags = getBaseFlags();
        const height = quality ? quality.replace('p', '') : '720';

        // Clean and sanitize the title passed from query, or fall back safely
        let videoTitle = 'YouTube_Media';
        if (title && title !== 'Ready for Download') {
            videoTitle = title.replace(/[<>:"/\\|?*]/g, '').trim();
        }

        const randomId = Math.random().toString(36).substring(7);
        const ext = format === 'mp3' ? 'mp3' : 'mp4';
        const tempFilePath = path.join(__dirname, `output_${randomId}.${ext}`);

        let downloadFlags = {
            ...flags,
            output: tempFilePath
        };

        if (format === 'mp3') {
            downloadFlags.format = 'bestaudio/best';
            downloadFlags.extractAudio = true;
            downloadFlags.audioFormat = 'mp3';
            downloadFlags.audioQuality = quality || '320';
        } else {
            downloadFlags.format = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
            downloadFlags.mergeOutputFormat = 'mp4';
        }

        console.log(`Starting download for "${videoTitle}" (${height}p) to temp file: ${tempFilePath}`);
        
        await ytdlp(url, downloadFlags);

        if (!fs.existsSync(tempFilePath)) {
            throw new Error('Download failed: Output file was not generated.');
        }

        const stat = fs.statSync(tempFilePath);
        const fileSize = stat.size;

        if (fileSize === 0) {
            throw new Error('Generated file is empty (0 bytes).');
        }

        if (format === 'mp3') {
            res.header('Content-Disposition', `attachment; filename="${videoTitle}.mp3"`);
            res.header('Content-Type', 'audio/mpeg');
        } else {
            res.header('Content-Disposition', `attachment; filename="${videoTitle}_${height}p.mp4"`);
            res.header('Content-Type', 'video/mp4');
        }
        res.header('Content-Length', fileSize);

        const fileStream = fs.createReadStream(tempFilePath);
        fileStream.pipe(res);

        fileStream.on('end', () => {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (e) {}
        });

        fileStream.on('error', (streamErr) => {
            console.error('File stream error:', streamErr);
            try { fs.unlinkSync(tempFilePath); } catch (e) {}
            if (!res.headersSent) res.status(500).send('Streaming failed');
        });

    } catch (err) {
        console.error('Download execution error details:', err.message || err);
        if (!res.headersSent) {
            res.status(500).send('Download failed: ' + (err.message || 'Server error'));
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running successfully at http://localhost:${PORT}`);
});

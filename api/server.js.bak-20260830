const express = require('express');
const fs = require('fs');
const path = require('path');
const sizeOf = require('image-size');
const cors = require('cors');
require('dotenv-flow/config');

const app = express();
const { WHITELISTED_DOMAINS, IMAGES_DIR, DOMAIN, PORT, NODE_ENV, PRIVKEY_PEM, FULLCHAIN_PEM } =
    process.env;
const WHITELIST = WHITELISTED_DOMAINS ? WHITELISTED_DOMAINS.split(',') : [];
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || WHITELIST.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error(`Domain '${origin}' not allowed by CORS`));
        }
    },
    credentials: true,
};
app.use(cors(corsOptions));

// Endpoint to serve image metadata
app.get('/metadata', (req, res) => {
    try {
        const files = fs.readdirSync(IMAGES_DIR);
        const imageFiles = files.filter((file) => /\.(jpe?g|png|gif)$/i.test(file));
        const imagesMetadata = imageFiles.map((file) => {
            try {
                const filePath = path.join(IMAGES_DIR, file);
                const dimensions = sizeOf(filePath);
                return {
                    src: `${DOMAIN}/images/${file}`,
                    width: dimensions.width,
                    height: dimensions.height,
                    // srcSet: [
                    //     {
                    //         src: `${DOMAIN}/images/${file}`,
                    //         width: dimensions.width,
                    //         height: dimensions.height,
                    //     },
                    // ],
                };
            } catch (error) {
                console.log(`Error reading metadata for ${file}:`);
                return undefined;
            }
        });
        res.json(imagesMetadata.filter((metadata) => metadata));
    } catch (error) {
        console.log(error);
        res.status(500).send('Error reading image metadata');
    }
});

// Serve static images
app.use('/images', express.static(IMAGES_DIR));

let server;
if (NODE_ENV === 'development') {
    const http = require('http');
    server = http.createServer(app);
} else {
    const https = require('https');
    const fs = require('fs');
    const options = {
        key: fs.readFileSync(PRIVKEY_PEM),
        cert: fs.readFileSync(FULLCHAIN_PEM),
    };
    server = https.createServer(options, app);
}
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
